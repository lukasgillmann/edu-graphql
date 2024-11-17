const { _getSQLAppClient, _fillHTMLTemplate } = require("../common/utility");
const { sendEmail } = require("../query/email");

exports.createCertificate = async (_, obj, ctx) => {
  const { userId, permission, is_ghost } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN", "USER"].indexOf(permission) < 0 || is_ghost) return false;

  const sqlAppClient = _getSQLAppClient();

  try {
    const { course_id, course_title, module_title, is_final, total, is_save } = obj.input;

    let query = `
      SELECT * FROM student_certificate
      WHERE user_id = ${userId} AND course_id = '${course_id}' AND module_title='${module_title}'
    `;

    let res = await sqlAppClient.query(query);

    if (!res || res.length == 0) {
      if (is_save) {
        query = `
          INSERT INTO student_certificate (user_id, course_id, course_title, module_title, is_final, total) 
          VALUES (${userId}, '${course_id}', '${course_title}', '${module_title}', ${is_final}, ${total});
        `;
        await sqlAppClient.query(query);
      }

      // Now send email to the user/admin // ****************************************************************
      const emailType = is_final ? "course_complete" : "module_complete";
      query = `SELECT username, first_name, last_name, email FROM auth_user WHERE id=${userId}`;
      res = await sqlAppClient.query(query);

      if (res && res.length) {
        res = res[0];
        const firstName = res.first_name || res.username;
        const lastName = res.last_name;
        const email = res.email;

        query = `SELECT subject, admin_email, content, schedule, end_user FROM email_template WHERE type='${emailType}' AND enabled=1`;
        res = await sqlAppClient.query(query);

        if (res && res.length) {
          const userRow = res.find((v) => v.end_user == "user");
          const adminRow = res.find((v) => v.end_user == "admin");

          const endUserHtml = userRow ? userRow.content : "";
          const adminHtml = adminRow ? adminRow.content : "";
          const adminEmail = userRow && userRow.admin_email ? userRow.admin_email : process.env.REACT_APP_CONTACT_EMAIL;

          const values = {
            PLATFORM_NAME: process.env.REACT_APP_SITE_DISPLAY_NAME,
            COURSE_TITLE: course_title,
            MODULE_TITLE: module_title,
            SURNAME: firstName,
            NAME: lastName,
            USER_ID: email,
            ADMIN_EMAIL: adminEmail,
            LOGIN_LINK: process.env.REACT_APP_AUTH_ENDPOINT,
            CURRENT_DATE: new Date().toISOString(),
          };

          if (endUserHtml) await sendEmail(emailType, email, _fillHTMLTemplate(userRow.subject, values), _fillHTMLTemplate(endUserHtml, values), course_title);
          if (adminHtml) await sendEmail(emailType, process.env.REACT_APP_CONTACT_EMAIL, _fillHTMLTemplate(adminRow.subject, values), _fillHTMLTemplate(adminHtml, values), course_title);
        }
      }
      // ***************************************************************************************************
    }

    return true;
  } catch (e) {
    console.log("[student certificate error]", e);
    return false;
  } finally {
    sqlAppClient.quit();
  }
};
