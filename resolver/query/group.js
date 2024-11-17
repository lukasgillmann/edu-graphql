const { _getSQLAppClient, SYSTEM_USERS } = require("../common/utility");

exports._getUserGroupList = async (sqlAppClient, userId) => {
  let query = "",
    res = "";
  query = `
    SELECT id, name, cover_url, DATE_FORMAT(created, '%Y-%m-%dT%TZ') AS created, description
    FROM auth_group
    WHERE id IN ( SELECT group_id FROM auth_user_groups WHERE user_id = ${userId} )
  `;

  const groups = await sqlAppClient.query(query);

  if (groups.length) {
    query = `
      SELECT G.user_id as id, G.group_id, A.username, A.first_name, A.last_name, A.email, A.is_active,
        B.avatar, B.cover,
        IF(A.is_superuser = 1, 'SUPERADMIN', IF(A.is_staff = 1, 'STAFF', IF(C.state = 'granted', 'ADMIN', 'USER'))) AS permission
      FROM auth_user_groups G
        LEFT JOIN auth_user A ON G.user_id = A.id AND A.email NOT IN (${SYSTEM_USERS.map((v) => `'${v}'`)}) AND A.is_superuser = 0
        LEFT JOIN auth_userprofile B ON A.id = B.user_id
        LEFT JOIN course_creators_coursecreator C ON C.user_id = A.id
      WHERE G.group_id IN (${groups.map((g) => '"' + g.id + '"')}) 
    `;

    res = (await sqlAppClient.query(query)) || [];

    for (let i = 0; i < groups.length; i++) {
      const users = res.filter((r) => r.group_id == groups[i].id);
      groups[i]["users"] = users;
    }
  }

  return groups;
};

exports._groupList = async (sqlAppClient, page, pageSize) => {
  let query = `
    SELECT *, DATE_FORMAT(created, '%Y-%m-%dT%TZ') AS created, DATE_FORMAT(updated, '%Y-%m-%dT%TZ') AS updated
    FROM auth_group LIMIT ${page * pageSize}, ${pageSize};
    SELECT COUNT(*) AS total FROM auth_group;
  `;

  let groups = await sqlAppClient.query(query);
  const total = groups[1][0].total;
  groups = groups[0];

  if (groups && groups.length) {
    // Init group
    for (let i = 0; i < groups.length; i++) {
      groups[i]["users"] = [];
      groups[i]["courses"] = [];
    }

    // [
    //   { id: 1, name: 'API Access Request Approvers' },
    //   { id: 2, name: 'new group' }
    // ]
    query = `
      SELECT G.user_id as id, G.group_id, A.username, A.first_name, A.last_name, A.email, A.is_active,
        B.avatar, B.cover,
        IF(A.is_superuser = 1, 'SUPERADMIN', IF(A.is_staff = 1, 'STAFF', IF(C.state = 'granted', 'ADMIN', 'USER'))) AS permission
      FROM auth_user_groups G
        LEFT JOIN auth_user A ON G.user_id = A.id AND A.email NOT IN (${SYSTEM_USERS.map((v) => `'${v}'`)}) AND A.is_superuser = 0
        LEFT JOIN auth_userprofile B ON A.id = B.user_id
        LEFT JOIN course_creators_coursecreator C ON C.user_id = A.id
      WHERE G.group_id IN (${groups.map((g) => '"' + g.id + '"')})
    `;
    let res = await sqlAppClient.query(query);

    let totalUserIds = [];
    if (res && res.length) {
      for (let i = 0; i < groups.length; i++) {
        const users = res.filter((r) => r.group_id == groups[i].id);
        groups[i]["users"] = users;
        totalUserIds = [...new Set([...totalUserIds, ...users.map((u) => u.id)])];
      }
    }

    if (totalUserIds.length) {
      query = `
        SELECT S.user_id, S.course_id AS id, S.is_active, V.display_name, V.short_description, S.start AS run_start, S.end AS run_end, V.course_image_url AS course_image_url, V.created
        FROM student_courseenrollment S
          LEFT JOIN course_overviews_courseoverview V ON S.course_id = V.id
        WHERE S.is_active=1 AND S.user_id IN (${totalUserIds.map((id) => '"' + id + '"')})
      `;

      res = await sqlAppClient.query(query);
    } else {
      res = [];
    }

    if (res && res.length) {
      for (let i = 0; i < groups.length; i++) {
        let commonCourses = [];
        for (let j = 0; j < groups[i]["users"].length; j++) {
          const courses = res.filter((r) => r.user_id == groups[i]["users"][j].id);

          if (j == 0) {
            commonCourses = courses;
          } else {
            commonCourses = commonCourses.filter((c) => courses.findIndex((cc) => cc.id == c.id) >= 0);
          }
        }

        // Redefine course run start/end dates
        let isSame = true;
        let cloneCourses = JSON.parse(JSON.stringify(commonCourses));
        for (let j = 0; j < cloneCourses.length; j++) {
          const otherCourses = res.filter((v) => v.id == cloneCourses[j].id);

          isSame = otherCourses.every((v) => new Date(v.run_start).getTime() == new Date(cloneCourses[j].run_start).getTime());
          if (!isSame) {
            cloneCourses[j].run_start = null;
          }

          isSame = otherCourses.every((v) => new Date(v.run_end).getTime() == new Date(cloneCourses[j].run_end).getTime());
          if (!isSame) {
            cloneCourses[j].run_end = null;
          }
        }
        groups[i]["courses"] = cloneCourses;
      }
    }
  }

  return { total, page, page_size: pageSize, data: groups };
};

exports.groupList = async (_, obj, ctx) => {
  const { permission } = ctx;

  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return null;

  const { page, page_size } = obj;

  const client = _getSQLAppClient();

  try {
    return await this._groupList(client, page, page_size);
  } catch (e) {
    console.log("[error]", e);
    return null;
  } finally {
    client.quit();
  }
};
