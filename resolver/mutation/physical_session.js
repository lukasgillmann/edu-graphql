const { _toSQLTime } = require("../common/time");
const { _getSQLAppClient, _fillHTMLTemplate } = require("../common/utility");
const { sendEmail } = require("../query/email");

exports.editPhysicalSession = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return null;

  const { id, coach_name, subject, program, location, start, duration, signature } = obj.input;
  const sqlAppClient = _getSQLAppClient();
  let query = "",
    res = "";

  try {
    if (id != undefined) {
      // update that item
      query += coach_name ? `coach_name='${coach_name}', ` : "";
      query += subject ? `subject='${subject}', ` : "";
      query += program ? `program='${program}', ` : "";
      query += location ? `location='${location}', ` : "";
      query += signature ? `signature='${signature}', ` : "";
      query += start ? `start='${_toSQLTime(new Date(start))}', ` : "";
      query += duration ? `duration=${duration}, ` : "";

      if (query) {
        query = query.slice(0, -2);
        query = `UPDATE physical_session SET ${query} WHERE id = ${id}`;
        res = await sqlAppClient.query(query);
      }
      return id;
    } else {
      // Insert new one
      query = `
        INSERT INTO physical_session (coach_name, subject, program, location, signature, start, duration) 
        VALUES ('${coach_name}', '${subject}', '${program}', '${location}', '${signature}', '${_toSQLTime(new Date(start))}', ${duration});
      `;
      res = await sqlAppClient.query(query);
      return res.insertId;
    }
  } catch (e) {
    console.log("[Edit Pref Err]", e);

    return null;
  } finally {
    sqlAppClient.quit();
  }
};

exports.assignUsersToPhysicalSession = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return false;

  const { session_id, user_ids } = obj;

  const sqlAppClient = _getSQLAppClient();
  let res = "",
    query = "";

  try {
    // Get email template
    const emailType = "physical_session_assign";
    query = `SELECT admin_email, subject, content FROM email_template WHERE type='${emailType}' AND enabled=1 AND end_user='user'`;
    res = await sqlAppClient.query(query);

    res = res[0];
    const endUserHtml = res.content ? res.content : "";
    const adminEmail = res.admin_email ? res.admin_email : process.env.REACT_APP_CONTACT_EMAIL;
    const subject = res.subject;

    // Get user information
    query = user_ids
      .map((v) => `(${session_id}, ${v}, 0), `)
      .join("")
      .slice(0, -2);
    query = `
      DELETE FROM physical_session_users WHERE user_id IN (${user_ids});
      INSERT INTO physical_session_users (session_id, user_id, status) VALUES ${query};
      UPDATE physical_session SET total_assigned = (
        SELECT COUNT(*) 
        FROM physical_session_users
        WHERE session_id = ${session_id}
      ) WHERE id = ${session_id};
      SELECT DISTINCT(A.username), A.id, A.first_name, A.last_name, A.email, C.coach_name, C.subject, C.program, C.location, C.signature, DATE_FORMAT(C.start, '%Y-%m-%dT%TZ') start, C.duration 
      FROM auth_user A
        LEFT JOIN physical_session_users B ON A.id = B.user_id
        LEFT JOIN physical_session C ON B.session_id = C.id AND C.id = ${session_id}
      WHERE A.id IN (${user_ids});`;
    res = await sqlAppClient.query(query);

    res = res[3];

    // Send email
    res.forEach(async (v) => {
      const values = {
        PLATFORM_NAME: process.env.REACT_APP_SITE_DISPLAY_NAME,
        SURNAME: v.first_name || v.username,
        NAME: v.last_name,
        USER_ID: v.email,
        ADMIN_EMAIL: adminEmail,
        LOGIN_LINK: process.env.REACT_APP_AUTH_ENDPOINT,
        COACH_NAME: v.coach_name,
        SUBJECT: v.subject,
        PROGRAM: v.program,
        LOCATION: v.location,
        SIGNATURE: v.signature,
        START: v.start,
        DURATION: v.duration,
        CURRENT_DATE: new Date().toISOString(),
      };
      await sendEmail(emailType, v.email, _fillHTMLTemplate(subject, values), _fillHTMLTemplate(endUserHtml, values));
    });

    return true;
  } catch (e) {
    console.log("[ERR]", e);

    return false;
  } finally {
    sqlAppClient.quit();
  }
};

exports.dismissUsersFromPhysicalSession = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return false;

  const { session_id, user_ids } = obj;

  const sqlAppClient = _getSQLAppClient();

  try {
    await sqlAppClient.query(`DELETE FROM physical_session_users WHERE session_id=${session_id} AND user_id IN (${user_ids})`);

    // Now update the total user field
    await sqlAppClient.query(`UPDATE physical_session SET total_assigned = total_assigned - ${user_ids.length} WHERE id = ${session_id}`);

    return true;
  } catch (e) {
    console.log("[ERR]", e);

    return false;
  } finally {
    sqlAppClient.quit();
  }
};

exports.deletePhysicalSession = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return false;

  const { session_id } = obj;

  const sqlAppClient = _getSQLAppClient();

  try {
    let query = `
      DELETE FROM physical_session WHERE id = ${session_id};
      DELETE FROM physical_session_users WHERE session_id = ${session_id};
    `;

    await sqlAppClient.query(query);

    return true;
  } catch (e) {
    console.log("[PRE ERR]", e);

    return false;
  } finally {
    sqlAppClient.quit();
  }
};
