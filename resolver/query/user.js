const jwt = require("jsonwebtoken");
const { _getSQLAppClient, SYSTEM_USERS, _getMongoLogClient, _fillHTMLTemplate, JWTSECRET, _jsonReplacer } = require("../common/utility");
const { sendEmail } = require("./email");
const { _listUserLastLogin } = require("./login_hist");

exports.getGhostToken = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return null;

  const { user_id } = obj;

  const sqlAppClient = _getSQLAppClient();

  try {
    let query = `
      SELECT A.id, A.password, A.is_superuser, A.is_staff, A.is_active, IF(B.state = 'granted', 1, 0) as is_admin
      FROM auth_user A
        LEFT JOIN course_creators_coursecreator B ON A.id=B.user_id
      WHERE A.id=${user_id}`;
    let res = await sqlAppClient.query(query);

    const user = res.length > 0 ? res[0] : null;
    if (!user || !user.is_active) throw Error("User not exist!");

    const permission = user.is_superuser ? "SUPERADMIN" : user.is_staff ? "STAFF" : user.is_admin ? "ADMIN" : "USER";
    const jwtToken = jwt.sign(
      {
        id: user_id,
        permission: permission,
        expired: 60 * 60 * 24,
        is_ghost: true,
      },
      JWTSECRET,
      { algorithm: "HS256" }
    );

    return jwtToken;
  } catch (e) {
    console.log("[get ghost token error]", e);
    return null;
  } finally {
    sqlAppClient.quit();
  }
};

exports.userEmailExist = async (_, obj) => {
  const { email } = obj;

  if (!/\w+@(\w|-)+\.\w+/.test(email)) return false;

  let query = `SELECT id FROM auth_user WHERE email='${email}';`;

  const sqlAppClient = _getSQLAppClient();
  const res = await sqlAppClient.query(query);

  sqlAppClient.quit();

  if (res && res.length > 0) {
    return true;
  } else {
    return false;
  }
};

exports._userList = async (sqlAppClient, mongoHistClient, userId, permission, page, pageSize) => {
  let query = `
    SELECT B.*, A.*, 
      DATE_FORMAT(A.date_joined, '%Y-%m-%dT%TZ') AS created, 
      IF(C.state = 'granted', 1, 0) as is_admin, 
      E.name as group_name,
      IF(A.is_superuser = 1, 'SUPERADMIN', IF(A.is_staff = 1, 'STAFF', IF(C.state = 'granted', 'ADMIN', 'USER'))) AS permission
    FROM auth_user A
      LEFT JOIN auth_userprofile B ON A.id = B.user_id
      LEFT JOIN course_creators_coursecreator C ON C.user_id = A.id
      LEFT JOIN (
        SELECT MIN(group_id) group_id, user_id
        FROM auth_user_groups
        GROUP BY user_id
      ) D ON A.id = D.user_id
      LEFT JOIN auth_group E ON D.group_id = E.id
    WHERE A.email NOT IN (${SYSTEM_USERS.map((v) => `'${v}'`)}) AND A.is_superuser = 0 AND A.id <> ${userId} ${permission == "ADMIN" ? " AND A.is_staff = 0" : ""}
    LIMIT ${page * pageSize}, ${pageSize};
    SELECT COUNT(*) AS total 
    FROM auth_user
    WHERE email NOT IN (${SYSTEM_USERS.map((v) => `'${v}'`)}) AND is_superuser = 0 AND id <> ${userId} ${permission == "ADMIN" ? " AND is_staff = 0" : ""};
  `;

  let res = await sqlAppClient.query(query);
  const total = res[1][0].total;
  res = res[0];

  if (res.length) {
    query = `
      SELECT user_id, COUNT(*) AS course_count
      FROM student_courseenrollment
      WHERE user_id IN (${res.map((r) => r.id)}) AND is_active=1
      GROUP BY user_id
    `;
    const courseRes = await sqlAppClient.query(query);

    const inspectRes = await mongoHistClient
      .db(process.env.MONGO_DB_INSPECT_NAME)
      .collection("inspect.module")
      .aggregate([{ $project: { user_id: 1, total_spent: 1 } }])
      .toArray();
    res = res.map((item) => ({
      ...item,
      ...(courseRes.find((v) => v.user_id === item.id) || { course_count: 0 }),
      ...{ total_spent: Math.round(inspectRes.filter((v) => v.user_id === item.id).reduce((a, b) => (b.total_spent ? a + b.total_spent : a), 0)) || 0 },
      ...(item.skills ? { skills: JSON.parse(item.skills) } : { skills: [] }),
    }));
  }

  return { total, page: page, page_size: pageSize, data: res };
};

exports.userList = async (_, obj, ctx) => {
  const { userId, permission } = ctx;

  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return null;

  const { page = 0, page_size = 5 } = obj;

  const sqlAppClient = _getSQLAppClient();
  const mongoHistClient = await _getMongoLogClient();

  try {
    return JSON.stringify(await this._userList(sqlAppClient, mongoHistClient, userId, permission, page, page_size), _jsonReplacer);
  } catch (e) {
    console.log("[error]", e);
    return null;
  } finally {
    sqlAppClient.quit();
    mongoHistClient.close();
  }
};

exports.sentReminderToUsers = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return false;

  const { user_ids } = obj;

  const sqlAppClient = _getSQLAppClient();
  const mongoHistClient = await _getMongoLogClient();

  let res = "",
    query = "";

  if (user_ids.length) query = ` AND id IN (${user_ids})`;
  try {
    query =
      `
      SELECT id, username, first_name, last_name, email 
      FROM auth_user
      WHERE is_superuser=0 AND is_staff=0 AND is_active=1 AND email NOT IN (${SYSTEM_USERS.map((v) => `'${v}'`)})
    ` + query;
    const userList = await sqlAppClient.query(query);
    const loginHists = await _listUserLastLogin(mongoHistClient);

    query = `SELECT subject, content FROM email_template WHERE type='login_reminder' AND enabled=1 AND end_user='user'`;
    res = await sqlAppClient.query(query);
    const userHtml = res && res.length ? res[0].content : null;
    const subject = res && res.length ? res[0].subject : "";

    if (userHtml && userList.length) {
      for (let user of userList) {
        const hist = loginHists.find((v) => v.user_id == user.id);

        if (!hist) {
          // Now send email ************************************************************************************************
          const values = {
            PLATFORM_NAME: process.env.REACT_APP_SITE_DISPLAY_NAME,
            LOGIN_LINK: process.env.REACT_APP_AUTH_ENDPOINT,
            SURNAME: user.first_name || user.username,
            NAME: user.last_name,
            USER_ID: user.email,
            ADMIN_EMAIL: process.env.REACT_APP_CONTACT_EMAIL,
            CURRENT_DATE: new Date().toISOString(),
          };
          await sendEmail("login_reminder", user.email, _fillHTMLTemplate(subject, values), _fillHTMLTemplate(userHtml, values));
          // Email End ************************************************************************************************
        }
      }
    }

    return true;
  } catch (e) {
    console.log("[error]", e);
    return false;
  } finally {
    sqlAppClient.quit();
    mongoHistClient.close();
  }
};

exports._userGet = async (sqlAppClient, userId, userPermission) => {
  const hash = Buffer.from(new Date().getTime().toString()).toString("base64");
  const query = `
    SELECT B.*, A.*, 
      DATE_FORMAT(A.date_joined, '%Y-%m-%dT%TZ') AS created, 
      IF(C.state = 'granted', 1, 0) as is_admin, 
      E.name as group_name,
      IF(A.is_superuser = 1, 'SUPERADMIN', IF(A.is_staff = 1, 'STAFF', IF(C.state = 'granted', 'ADMIN', 'USER'))) AS permission
    FROM auth_user A
      LEFT JOIN auth_userprofile B ON A.id = B.user_id
      LEFT JOIN course_creators_coursecreator C ON A.id = C.user_id
      LEFT JOIN auth_user_groups D ON A.id = D.user_id
      LEFT JOIN auth_group E ON D.group_id = E.id
    WHERE A.id = ${userId};
    UPDATE auth_userprofile SET hash = '${hash}' WHERE user_id = ${userId};
  `;
  let res = await sqlAppClient.query(query);

  res = res[0].length ? res[0][0] : {};
  res.skills = res.skills ? JSON.parse(res.skills) : [];
  res.permission = userPermission;
  res.hash = hash;

  return res;
};

exports.userGet = async (_, obj, ctx) => {
  const { userId, permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN", "USER"].indexOf(permission) < 0) return {};

  const sqlAppClient = _getSQLAppClient();

  try {
    return await this._userGet(sqlAppClient, userId, permission);
  } catch (e) {
    console.log("[user err]", e);
    return {};
  } finally {
    sqlAppClient.quit();
  }
};

exports.userCourseList = async (_, obj, ctx) => {
  const { permission } = ctx;

  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return null;

  const { user_id } = obj;

  const sqlAppClient = _getSQLAppClient();

  try {
    const query = `
      SELECT S.course_id AS id, V.display_name, V.short_description, V.course_image_url AS course_image_url,
        DATE_FORMAT(S.start, '%Y-%m-%dT%TZ') AS run_start,
        DATE_FORMAT(S.end, '%Y-%m-%dT%TZ') AS run_end,
        DATE_FORMAT(S.created, '%Y-%m-%dT%TZ') AS created
      FROM student_courseenrollment S
        LEFT JOIN course_overviews_courseoverview V ON S.course_id = V.id
      WHERE S.is_active=1 AND S.user_id = ${user_id}
    `;

    let res = await sqlAppClient.query(query);
    return res;
  } catch (e) {
    console.log("[error]", e);
    return null;
  } finally {
    sqlAppClient.quit();
  }
};

exports._getAdminInfo = async (sqlAppClient) => {
  const query = `
    SELECT A.id, A.username, A.first_name, A.last_name, A.email, C.avatar, C.cover, C.phone_number, C.role, C.location
    FROM auth_user A
      LEFT JOIN course_creators_coursecreator B ON A.id = B.user_id
      LEFT JOIN auth_userprofile C ON A.id = C.user_id
    WHERE A.is_staff = 0 AND A.is_superuser = 0 AND B.state = 'granted';
  `;
  const res = await sqlAppClient.query(query);
  return res.length ? res[0] : {};
};
