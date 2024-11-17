// const AWS = require('aws-sdk');
const { _getMongoLogClient, _getSQLAppClient, _fillHTMLTemplate } = require("../common/utility");
const { _insertEmailLog } = require("../mutation/email");
const crypto = require("crypto");
const axios = require("axios");

exports.sendEmail = async (type, toEmail, subject, html, courseTitle = "") => {
  console.log("[sending .......... email ...........]");
  return true;
  // const res = await axios.post(
  //   "https://send.plateformedoctonet.com/api",
  //   JSON.stringify({
  //     query: `
  //       query send_mail($data: [MailOption]) {
  //         send_mail(data: $data)
  //       }
  //     `,
  //     variables: {
  //       data: [
  //         {
  //           from: process.env.REACT_APP_SITE_DISPLAY_NAME,
  //           to: toEmail,
  //           subject: subject,
  //           html: html,
  //         },
  //       ],
  //     },
  //   }),
  //   {
  //     headers: {
  //       Authorization: process.env.REACT_APP_TEST_JWT_TOKEN,
  //       "Content-Type": "application/json",
  //     },
  //   }
  // );

  // if (res && res.data && res.data.data && res.data.data.send_mail) {
  //   if (type != "inactivity" && type != "no-insert") await _insertEmailLog(type, toEmail, courseTitle);
  //   console.log("[Email send success!]", type);
  //   return true;
  // } else {
  //   console.log("[email send error!]");
  //   return false;
  // }
};

exports._emailLogList = async (sqlAppClient, mongoHistClient, page, pageSize) => {
  const proData = mongoHistClient
    .db(process.env.MONGO_DB_INSPECT_NAME)
    .collection("email.log")
    .aggregate([{ $sort: { time: -1 } }, { $skip: pageSize * page }, { $limit: pageSize }])
    .toArray();

  const proTotal = mongoHistClient
    .db(process.env.MONGO_DB_INSPECT_NAME)
    .collection("email.log")
    .aggregate([{ $group: { _id: null, count: { $sum: 1 } } }])
    .toArray();

  let [dbData, totalCount] = await Promise.all([proData, proTotal]);
  totalCount = totalCount.length ? totalCount[0].count : 0;

  let logs = {
    total: totalCount,
    page: page,
    page_size: pageSize,
    data: dbData,
  };

  // Attach user info
  const emails = logs.data.map((v) => v.to);
  if (emails.length) {
    const sqlRes = await sqlAppClient.query(`
      SELECT A.email, A.username, TRIM(CONCAT(A.first_name, ' ', A.last_name)) AS fullname, B.avatar, B.cover,
        IF(A.is_superuser = 1, 'SUPERADMIN', IF(A.is_staff = 1, 'STAFF', IF(C.state = 'granted', 'ADMIN', 'USER'))) AS permission
      FROM auth_user AS A
        LEFT JOIN auth_userprofile AS B ON A.id = B.user_id
        LEFT JOIN course_creators_coursecreator C ON C.user_id = A.id
      WHERE email IN (${emails.map((v) => '"' + v + '"')});
    `);
    logs.data = logs.data.map((item) => ({ ...item, ...(sqlRes.find((v) => v.email === item.to) || { username: "system", fullname: "Administrator" }) }));
  }

  return logs;
};

exports._emailRecentLogList = async (sqlAppClient, mongoHistClient) => {
  let logs = await mongoHistClient
    .db(process.env.MONGO_DB_INSPECT_NAME)
    .collection("email.log")
    .aggregate([
      { $sort: { time: -1 } },
      {
        $match: {
          type: { $in: ["course_complete", "module_complete", "course_comment", "course_rating", "course_assigned"] },
        },
      },
    ])
    .toArray();

  // Attach user info
  const emails = logs.map((v) => v.to);
  if (emails.length) {
    const sqlRes = await sqlAppClient.query(`
      SELECT A.email, A.username, TRIM(CONCAT(A.first_name, ' ', A.last_name)) AS fullname, B.avatar, B.cover,
        IF(A.is_superuser = 1, 'SUPERADMIN', IF(A.is_staff = 1, 'STAFF', IF(C.state = 'granted', 'ADMIN', 'USER'))) AS permission
      FROM auth_user AS A
        LEFT JOIN auth_userprofile AS B ON A.id = B.user_id
        LEFT JOIN course_creators_coursecreator C ON C.user_id = A.id
      WHERE email IN (${emails.map((v) => '"' + v + '"')});
    `);
    logs = logs.map((item) => ({ ...item, ...(sqlRes.find((v) => v.email === item.to) || { username: "system", fullname: "Administrator" }) }));
  }

  return logs;
};

exports.emailLogList = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return null;

  const { page, page_size } = obj;

  const sqlAppClient = _getSQLAppClient();
  const mongoClient = await _getMongoLogClient();

  try {
    return await this._emailLogList(sqlAppClient, mongoClient, page, page_size);
  } catch (e) {
    console.log("[err]", e);
    return null;
  } finally {
    sqlAppClient.quit();
    mongoClient.close();
  }
};

exports.emailAllLogList = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return null;

  const sqlAppClient = _getSQLAppClient();
  const mongoClient = await _getMongoLogClient();

  try {
    return await this._emailLogList(sqlAppClient, mongoClient, 0, 10000);
  } catch (e) {
    console.log("[err]", e);
    return null;
  } finally {
    sqlAppClient.quit();
    mongoClient.close();
  }
};

exports._emailTemplateList = async (sqlHistClient) => {
  let query = `
    SELECT id, type, enabled, schedule, end_user, content, variable, admin_email, subject,
      DATE_FORMAT(created, '%Y-%m-%dT%TZ') AS created, 
      DATE_FORMAT(updated, '%Y-%m-%dT%TZ') AS updated
    FROM email_template
    WHERE variable <> "";
  `;

  let templates = await sqlHistClient.query(query);
  templates = templates.map((v) => {
    let parsed = [];
    try {
      parsed = JSON.parse(v.variable);
    } catch (e) {
      console.log("[parse error]", e);
    }
    return { ...v, variable: parsed };
  });
  return templates;
};

exports.emailTemplateList = async (_, obj, ctx) => {
  const { permission } = ctx;

  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return null;

  const sqlAppClient = _getSQLAppClient();

  try {
    return await this._emailTemplateList(sqlAppClient);
  } catch (e) {
    console.log("[error]", e);
    return null;
  } finally {
    sqlAppClient.quit();
  }
};

exports.sendSurveyEmail = async (_, obj, ctx) => {
  const { userId, permission, is_ghost } = ctx;

  if (["SUPERADMIN", "STAFF", "ADMIN", "USER"].indexOf(permission) < 0 || is_ghost) return false;

  const items = obj.input;

  if (!Array.isArray(items)) return false;

  const sqlAppClient = _getSQLAppClient();

  let res = "",
    query = "";

  try {
    // Now send email to the user for password change // ****************************************************************
    const emailType = "survey_complete";
    query = `
      SELECT subject, content, schedule
      FROM email_template 
      WHERE type='${emailType}' AND enabled=1 AND end_user='admin'
    `;
    res = await sqlAppClient.query(query);

    if (!res || !res.length) throw Error("Email template does not exist");

    res = res[0];
    const emailTemplate = res.content;
    const subject = res.subject;

    if (!emailTemplate) throw Error("Email template not found");

    query = `
      SELECT id, email, username, first_name, last_name
      FROM auth_user
      WHERE id = ${userId};  
    `;
    res = await sqlAppClient.query(query);

    if (!res || !res.length) throw Error("User information not found!");

    const currUser = res[0];

    const values = {
      PLATFORM_NAME: process.env.REACT_APP_SITE_DISPLAY_NAME,
      SURNAME: currUser.first_name || currUser.username,
      NAME: currUser.last_name,
      USER_ID: currUser.email,
      LOGIN_LINK: process.env.REACT_APP_AUTH_ENDPOINT,
      ADMIN_EMAIL: process.env.REACT_APP_CONTACT_EMAIL,
      CURRENT_DATE: new Date().toISOString(),
    };

    let placeHolder = "";
    items.forEach(({ question, answer }) => {
      placeHolder += `
        <div>
          <p><b>Question: ${question}</b></p>
          <p>Answer: ${answer}</p>
        </div>
      `;
    });

    await this.sendEmail(emailType, process.env.REACT_APP_CONTACT_EMAIL, _fillHTMLTemplate(subject, values), _fillHTMLTemplate(emailTemplate, values, placeHolder));
    // ***************************************************************************************************

    return true;
  } catch (e) {
    console.log("[password reset request error]", e);
    return false;
  } finally {
    sqlAppClient.quit();
  }
};

exports.sendTestEmail = async (_, obj, ctx) => {
  const { permission } = ctx;

  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return false;

  const { email, name, html } = obj;
  await this.sendEmail("test", email, name, html);
  return true;
};

exports.sendToCoachEmail = async (_, obj, ctx) => {
  const { permission, is_ghost } = ctx;

  if (["SUPERADMIN", "STAFF", "ADMIN", "USER"].indexOf(permission) < 0 || is_ghost) return false;

  const { email, name, html } = obj;
  await this.sendEmail("to_coach", email, name, html);
  return true;
};

exports.sendPasswordResetEmail = async (_, obj, ctx) => {
  const { permission } = ctx;

  if (["SUPERADMIN", "STAFF", "ADMIN", "USER", "TESTUSER"].indexOf(permission) < 0) return false;

  const { email } = obj;

  const sqlAppClient = _getSQLAppClient();

  let res = "",
    query = "";

  try {
    // Now send email to the user for password change // ****************************************************************
    const emailType = "password_reset_request";
    query = `
      SELECT admin_email, subject, content, schedule
      FROM email_template 
      WHERE type='${emailType}' AND enabled=1 AND end_user='user'
    `;
    res = await sqlAppClient.query(query);

    if (!res || !res.length) throw Error("Email template does not exist");

    res = res[0];
    const emailTemplate = res.content;
    const subject = res.subject;

    if (!emailTemplate) throw Error("Email template not found");

    query = `
      SELECT id, email, username, first_name, last_name
      FROM auth_user
      WHERE email = '${email}';  
    `;
    res = await sqlAppClient.query(query);

    if (!res || !res.length) throw Error("User information not found!");

    const currUser = res.find((v) => v.email == email);
    if (!currUser) throw Error("There is no user with the given email!");

    // Now send user for reset page link
    const password_hash = crypto.randomBytes(48).toString("base64").replace(/\//g, "");
    query = `UPDATE auth_user SET password_hash='${password_hash}' WHERE email='${email}'`;
    await sqlAppClient.query(query);
    const values = {
      PLATFORM_NAME: process.env.REACT_APP_SITE_DISPLAY_NAME,
      SURNAME: currUser.first_name || currUser.username,
      NAME: currUser.last_name,
      USER_ID: email,
      LOGIN_LINK: `${process.env.REACT_APP_AUTH_ENDPOINT}/reset/${currUser.id}/${password_hash}`,
      ADMIN_EMAIL: process.env.REACT_APP_CONTACT_EMAIL,
      CURRENT_DATE: new Date().toISOString(),
    };
    await this.sendEmail(emailType, email, _fillHTMLTemplate(subject, values), _fillHTMLTemplate(emailTemplate, values));
    // ***************************************************************************************************

    return true;
  } catch (e) {
    console.log("[password reset request error]", e);
    return false;
  } finally {
    sqlAppClient.quit();
  }
};
