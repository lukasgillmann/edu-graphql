const { _getSQLAppClient, DEFAULT_OUTPUT } = require("../common/utility");

exports._listPhysicalSession = async (sqlAppClient, page = 0, pageSize = DEFAULT_OUTPUT.page_size) => {
  let query = `
    SELECT *, DATE_FORMAT(start, '%Y-%m-%dT%TZ') start
    FROM physical_session
    LIMIT ${page * pageSize}, ${pageSize};
    SELECT COUNT(*) AS total FROM physical_session;
  `;

  let res = await sqlAppClient.query(query);
  const total = res[1][0].total;
  res = res[0];

  // Attach users
  if (res.length) {
    // Init users
    for (let i = 0; i < res.length; i++) res[i]["users"] = [];

    query = `
      SELECT A.user_id as id, A.session_id, B.username, B.first_name, B.last_name, B.email, B.is_active, C.avatar, C.cover,
        IF(B.is_superuser = 1, 'SUPERADMIN', IF(B.is_staff = 1, 'STAFF', IF(D.state = 'granted', 'ADMIN', 'USER'))) AS permission
      FROM physical_session_users A
        LEFT JOIN auth_user B ON A.user_id = B.id
        LEFT JOIN auth_userprofile C ON A.user_id = C.user_id
        LEFT JOIN course_creators_coursecreator D ON D.user_id = A.user_id
      WHERE A.session_id IN (${res.map((v) => '"' + v.id + '"')});
    `;
    const totalUsers = await sqlAppClient.query(query);

    if (totalUsers.length) {
      for (let i = 0; i < res.length; i++) {
        const users = totalUsers.filter((r) => r.session_id == res[i].id);
        res[i]["users"] = users;
      }
    }
  }

  return { total, page, page_size: pageSize, data: res };
};

exports.listPhysicalSession = async (_, obj, ctx) => {
  const { permission } = ctx;

  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return [];

  const { page, page_size } = obj;
  const sqlAppClient = _getSQLAppClient();

  try {
    return await this._listPhysicalSession(sqlAppClient, page, page_size);
  } catch (e) {
    console.log("[error]", e);
    return [];
  } finally {
    sqlAppClient.quit();
  }
};

exports._listPhysicalSessionUsers = async (sqlAppClient, id, page = 0, pageSize = DEFAULT_OUTPUT.page_size) => {
  // Update envelope status
  let query = "",
    res = "";

  query = `
    SELECT A.id, A.status, B.id AS user_id, B.email, B.username, B.first_name, B.last_name, DATE_FORMAT(A.created, '%Y-%m-%dT%TZ') created, DATE_FORMAT(A.created, '%Y-%m-%dT%TZ') updated
    FROM physical_session_users A
      LEFT JOIN auth_user B ON A.user_id = B.id
    WHERE session_id = ${id}
    LIMIT ${page * pageSize}, ${pageSize};
    SELECT COUNT(*) AS total FROM physical_session_users;
  `;

  res = await sqlAppClient.query(query);
  const total = res[1][0].total;
  res = res[0];

  return { total, page, page_size: pageSize, data: res };
};

exports.listPhysicalSessionUsers = async (_, obj, ctx) => {
  const { permission } = ctx;

  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return null;

  const { session_id, page, page_size } = obj;
  const sqlAppClient = _getSQLAppClient();

  try {
    return await this._listPhysicalSessionUsers(sqlAppClient, session_id, page, page_size);
  } catch (e) {
    console.log("[error]", e);
    return null;
  } finally {
    sqlAppClient.quit();
  }
};
