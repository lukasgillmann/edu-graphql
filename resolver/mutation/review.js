const { _getSQLAppClient, _fillHTMLTemplate, _renderSQLValue } = require("../common/utility");
const { sendEmail } = require("../query/email");

exports.editReview = async (_, obj, ctx) => {
  const { userId, permission, is_ghost } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN", "USER"].indexOf(permission) < 0 || is_ghost) return false;

  const sqlAppClient = _getSQLAppClient();

  try {
    const { course_id, vertical_id, section_title, sequence_title, vertical_title, type, content } = obj.input;

    let query = `
      SELECT * FROM student_review
      WHERE user_id = ${userId} AND course_id = '${course_id}' AND vertical_id = '${vertical_id}'
    `;

    let res = await sqlAppClient.query(query);

    let queryMain = "";
    if (res && res.length) {
      // update that item
      const id = res[0]["id"];
      queryMain = `
        UPDATE student_review
        SET 
          type='${type}', 
          content=${_renderSQLValue(content)}, 
          section_title=${_renderSQLValue(section_title)},
          sequence_title=${_renderSQLValue(sequence_title)}
          vertical_title=${_renderSQLValue(vertical_title)}
        WHERE id = ${id}
      `;
    } else {
      // Insert new one
      queryMain = `
        INSERT INTO student_review (user_id, course_id, vertical_id, type, content, section_title, sequence_title, vertical_title) 
        VALUES (${userId}, '${course_id}', '${vertical_id}', '${type}', ${_renderSQLValue(content)}, ${_renderSQLValue(section_title)}, ${_renderSQLValue(sequence_title)}, ${_renderSQLValue(vertical_title)});
      `;

      // Now send email to the user/admin // ****************************************************************
      const emailType = "course_rating";
      query = `SELECT subject, content FROM email_template WHERE type='${emailType}' AND enabled=1 AND end_user='admin'`;
      res = await sqlAppClient.query(query);
      const adminHtml = res && res.length ? res[0].content : null;
      const subject = res && res.length ? res[0].subject : null;

      if (adminHtml) {
        query = `SELECT display_name FROM course_overviews_courseoverview WHERE id='${course_id}'`;
        res = await sqlAppClient.query(query);
        const courseTitle = res && res.length ? res[0].display_name : "";

        query = `SELECT username, first_name, last_name, email FROM auth_user WHERE id='${userId}'`;
        res = await sqlAppClient.query(query);
        if (res && res.length) {
          res = res[0];
          const email = res.email;

          const values = {
            PLATFORM_NAME: process.env.REACT_APP_SITE_DISPLAY_NAME,
            SURNAME: res.first_name || res.username,
            NAME: res.last_name,
            USER_ID: res.email,
            COURSE_TITLE: courseTitle,
            COURSE_RATE: `${content}`,
            LOGIN_LINK: process.env.REACT_APP_AUTH_ENDPOINT,
            CURRENT_DATE: new Date().toISOString(),
          };

          await sendEmail(emailType, email, _fillHTMLTemplate(subject, values), _fillHTMLTemplate(adminHtml, values), courseTitle);
        }
      }
      // ***************************************************************************************************
    }

    res = await sqlAppClient.query(queryMain);

    return true;
  } catch (e) {
    console.log("[Edit review Err]", e);
    return false;
  } finally {
    sqlAppClient.quit();
  }
};

exports.deleteReview = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return false;

  const { review_id } = obj;
  const sqlAppClient = _getSQLAppClient();

  try {
    let query = `
      DELETE 
      FROM student_review
      WHERE id=${review_id}
    `;

    await sqlAppClient.query(query);

    return true;
  } catch (e) {
    console.log("[HIS ERR]", e);
    return false;
  } finally {
    sqlAppClient.quit();
  }
};
