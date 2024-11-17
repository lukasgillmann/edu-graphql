const { _getSQLAppClient, SYSTEM_USERS, DEFAULT_OUTPUT } = require("../common/utility");

exports._listSearch = async (sqlAppClient, userId, permission, search = "") => {
  let res = "";
  const PAGE_SIZE = DEFAULT_OUTPUT.page_size;

  const courses = await sqlAppClient.query(`
    SELECT A.id, A.display_name, A.course_image_url, 
      DATE_FORMAT(A.created, '%Y-%m-%dT%TZ') AS created,
      E.name AS category
    FROM course_overviews_courseoverview A
      LEFT JOIN category_course D ON A.id = D.course_id
      LEFT JOIN category_overview E ON D.category_id = E.id
    WHERE A.display_name LIKE '%${search}%'
    ORDER BY A.id
    LIMIT 0, 10;
  `);
  const courseIds = courses.map((v) => v.id);

  if (courseIds.length) {
    res = await sqlAppClient.query(`
      SELECT A.*
      FROM (
        SELECT (@row_number := @row_number + 1) as rw_number, id
        FROM course_overviews_courseoverview, (SELECT @row_number := -1) AS x
      ) AS A
      WHERE A.id IN (${courseIds.map((id) => '"' + id + '"')});
    `);

    for (let i = 0; i < courses.length; i++) {
      const courseId = courses[i].id;
      const item = res.find((v) => v.id === courseId) || { rw_number: 0 };
      courses[i]["page_index"] = item.rw_number % PAGE_SIZE;
      courses[i]["page"] = Math.floor(item.rw_number / PAGE_SIZE);
    }
  }

  // User search
  let users = [];
  if (permission != "USER") {
    users = await sqlAppClient.query(`
      SELECT A.id, A.first_name, A.last_name, A.email, A.username, B.avatar, 
        DATE_FORMAT(A.date_joined, '%Y-%m-%dT%TZ') AS created, 
        E.name as group_name,
        IF(A.is_superuser = 1, 'SUPERADMIN', IF(A.is_staff = 1, 'STAFF', IF(C.state = 'granted', 'ADMIN', 'USER'))) AS permission
      FROM auth_user A
        LEFT JOIN auth_userprofile B ON A.id = B.user_id
        LEFT JOIN course_creators_coursecreator C ON C.user_id = A.id
        LEFT JOIN auth_user_groups D ON A.id = D.user_id
        LEFT JOIN auth_group E ON D.group_id = E.id
      WHERE A.email NOT IN (${SYSTEM_USERS.map((v) => `'${v}'`)}) AND A.is_superuser = 0 AND A.id <> ${userId} ${permission == "ADMIN" ? " AND A.is_staff = 0" : ""} AND (A.first_name LIKE '%${search}%' OR A.last_name LIKE '%${search}%')
      LIMIT 0, 10;
    `);
    const userIds = users.map((v) => v.id);

    if (userIds.length) {
      res = await sqlAppClient.query(`
        SELECT A.*
        FROM (
          SELECT (@row_number := @row_number + 1) as rw_number, id
          FROM auth_user, (SELECT @row_number := -1) AS x
          WHERE email NOT IN (${SYSTEM_USERS.map((v) => `'${v}'`)}) AND is_superuser = 0 AND id <> ${userId} ${permission == "ADMIN" ? " AND is_staff = 0" : ""}
        ) AS A
        WHERE id IN (${userIds});
      `);

      for (let i = 0; i < users.length; i++) {
        const userId = users[i].id;
        const item = res.find((v) => v.id === userId) || { rw_number: 0 };
        users[i]["page_index"] = item.rw_number % PAGE_SIZE;

        users[i]["page"] = Math.floor(item.rw_number / PAGE_SIZE);
      }
    }
  }

  return { courses: courses || [], users };
};

exports.listSearch = async (_, obj, ctx) => {
  const { userId, permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN", "USER"].indexOf(permission) < 0) return null;

  const { search_term } = obj;
  const appClient = _getSQLAppClient();

  try {
    return await this._listSearch(appClient, userId, permission, search_term);
  } catch (e) {
    console.log("[course list error]", e);
    return null;
  } finally {
    appClient.quit();
  }
};
