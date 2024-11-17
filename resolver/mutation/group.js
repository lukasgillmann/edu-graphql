const { _toSQLTime } = require("../common/time");
const { _getSQLAppClient, _fillHTMLTemplate } = require("../common/utility");
const { sendEmail } = require("../query/email");

exports.editGroup = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return null;

  const { group_id, name, cover_url, description } = obj;

  const sqlAppClient = _getSQLAppClient();

  let query = "";
  try {
    if (group_id) {
      // Edit mode
      query = `UPDATE auth_group SET name = '${name}', cover_url = '${cover_url}', description = '${description}' WHERE id=${group_id}`;
    } else {
      // Create mode
      query = `INSERT INTO auth_group (name, cover_url, description) VALUES ('${name}', '${cover_url}', '${description}')`;
    }

    const res = await sqlAppClient.query(query);

    return res.insertId;
  } catch (e) {
    console.log("[user Err]", e);

    return null;
  } finally {
    sqlAppClient.quit();
  }
};

exports.assignUsersToGroup = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return false;

  const { group_id, user_ids } = obj;

  const sqlAppClient = _getSQLAppClient();

  let query = "";
  try {
    query = `SELECT * FROM auth_group WHERE id=${group_id}`;
    let res = await sqlAppClient.query(query);

    if (res && res.length) {
      query = `
        SELECT * 
        FROM auth_user_groups
        WHERE group_id=${group_id} AND user_id IN (${user_ids.map((userId) => '"' + userId + '"')})
      `;
      res = await sqlAppClient.query(query);

      let todoUserIds = [];
      for (let userId of user_ids) {
        if (res.findIndex((r) => r.user_id == userId) < 0) {
          todoUserIds.push(userId);
        }
      }

      query = "";
      for (let userId of todoUserIds) {
        query += `(${group_id}, ${userId}), `;
      }
      query = query.slice(0, -2);

      if (query) {
        query = `INSERT INTO auth_user_groups (group_id, user_id) VALUES ${query}`;
        await sqlAppClient.query(query);
      }
    }

    return true;
  } catch (e) {
    console.log("[user Err]", e);

    return false;
  } finally {
    sqlAppClient.quit();
  }
};

exports.dismissUsersFromGroup = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return false;

  const { group_id, user_ids } = obj;

  const sqlAppClient = _getSQLAppClient();

  let query = "";
  try {
    query = `DELETE FROM auth_user_groups WHERE user_id IN (${user_ids.map((id) => '"' + id + '"')}) AND group_id=${group_id}`;
    await sqlAppClient.query(query);

    return true;
  } catch (e) {
    console.log("[user Err]", e);

    return false;
  } finally {
    sqlAppClient.quit();
  }
};

exports.assignCoursesToGroup = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return false;

  const { group_id, course_ids } = obj;

  const sqlAppClient = _getSQLAppClient();

  let query = "";
  try {
    const nextYear = _toSQLTime(new Date(new Date().setFullYear(new Date().getFullYear() + 1)));

    query = `SELECT user_id FROM auth_user_groups WHERE group_id=${group_id}`;
    let res = await sqlAppClient.query(query);

    if (!res || res.length == 0) throw Error("users not exist");

    const userIds = res.map((g) => g.user_id);

    query = `
        SELECT U.id, U.course_id, U.user_id
        FROM (
          SELECT *
          FROM student_courseenrollment 
          WHERE user_id IN (${userIds.map((id) => '"' + id + '"')})
        ) as U
          INNER JOIN (
            SELECT *
            FROM student_courseenrollment 
            WHERE course_id IN (${course_ids.map((id) => '"' + id + '"')})
          ) as C ON U.id = C.id
      `;
    res = await sqlAppClient.query(query); // Get student_courseenrollment table ids for those users

    if (res && res.length) {
      // If there are already rows in the table, then update is_active field
      query = `
          UPDATE student_courseenrollment
          SET is_active = 1, end='${nextYear}'
          WHERE id IN (${res.map((u) => '"' + u.id + '"')})
        `;
      await sqlAppClient.query(query);
    }

    // Find items that are not exist in the database
    let pair = []; // { userId, courseId }
    for (let courseId of course_ids) {
      for (let userId of userIds) {
        const idx = res.findIndex((r) => r.course_id == courseId && r.user_id == userId);
        if (idx < 0) {
          pair.push({ userId, courseId });
        }
      }
    }

    // Build query string
    query = "";
    const currDate = _toSQLTime(new Date());
    for (let item of pair) {
      query += `('${item.courseId}', '${currDate}', 1, 'audit', ${item.userId}, '${nextYear}'), `;
    }
    if (query) {
      query = query.slice(0, -2);
      query = `INSERT INTO student_courseenrollment (course_id, created, is_active, mode, user_id, end) VALUES ${query}`;
      await sqlAppClient.query(query);
    }

    // Now send email to the user // ****************************************************************
    const emailType = "course_assigned";
    query = `SELECT admin_email, subject, content FROM email_template WHERE type='${emailType}' AND enabled=1 AND end_user='user'`;
    res = await sqlAppClient.query(query);

    if (res && res.length) {
      res = res[0];
      const endUserHtml = res.content ? res.content : "";
      const adminEmail = res.admin_email ? res.admin_email : process.env.REACT_APP_CONTACT_EMAIL;
      const subject = res.subject;

      query = `SELECT display_name FROM course_overviews_courseoverview WHERE id IN (${course_ids.map((v) => '"' + v + '"')})`;
      res = await sqlAppClient.query(query);

      const placeHolder = res.map((v) => `<p style="text-align: center;">${v.display_name}</p>`).join("");

      query = `SELECT username, first_name, last_name, email FROM auth_user WHERE id IN (${userIds.map((id) => '"' + id + '"')})`;
      res = await sqlAppClient.query(query);

      if (placeHolder && res && res.length) {
        for (let v of res) {
          const email = v.email;

          const values = {
            PLATFORM_NAME: process.env.REACT_APP_SITE_DISPLAY_NAME,
            SURNAME: v.first_name || v.username,
            NAME: v.last_name,
            USER_ID: v.email,
            ADMIN_EMAIL: adminEmail,
            LOGIN_LINK: process.env.REACT_APP_AUTH_ENDPOINT,
            CURRENT_DATE: new Date().toISOString(),
          };

          await sendEmail(emailType, email, _fillHTMLTemplate(subject, values), _fillHTMLTemplate(endUserHtml, values, placeHolder));
        }
      }
    }
    // ***************************************************************************************************

    return true;
  } catch (e) {
    console.log("[user Err]", e);

    return false;
  } finally {
    sqlAppClient.quit();
  }
};

exports.dismissCoursesFromGroup = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return false;

  const { group_id, course_ids } = obj;

  const sqlAppClient = _getSQLAppClient();

  let query = "";
  try {
    query = `
      SELECT user_id
      FROM auth_user_groups
      WHERE group_id=${group_id}
    `;
    let res = await sqlAppClient.query(query);

    if (res && res.length) {
      query = `
        UPDATE student_courseenrollment 
        SET is_active = 0
        WHERE user_id IN (${res.map((item) => '"' + item.user_id + '"')}) AND course_id IN (${course_ids.map((courseId) => '"' + courseId + '"')})
      `;
      res = await sqlAppClient.query(query);
    }

    return true;
  } catch (e) {
    console.log("[user Err]", e);

    return false;
  } finally {
    sqlAppClient.quit();
  }
};

exports.deleteGroup = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return false;

  const { group_id } = obj;

  const sqlAppClient = _getSQLAppClient();

  let query = "";
  try {
    query = `
      DELETE FROM auth_user_groups WHERE group_id=${group_id};
      DELETE FROM auth_group_permissions WHERE group_id=${group_id};
      DELETE FROM auth_group WHERE id=${group_id};
    `;
    await sqlAppClient.query(query);

    return true;
  } catch (e) {
    console.log("[user Err]", e);

    return false;
  } finally {
    sqlAppClient.quit();
  }
};
