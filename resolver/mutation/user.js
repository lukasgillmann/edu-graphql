const { _getSQLAppClient, JWTSECRET, _fillHTMLTemplate, SYSTEM_USERS, _generateRandomPwd, _getSQLQuery } = require("../common/utility");
const crypto = require("crypto");
const uuid = require("uuid");

const jwt = require("jsonwebtoken");
const { sendEmail } = require("../query/email");
const { editLoginHist } = require("./login_hist");
const { _getAvailableLicenseNumber } = require("../query/license");
const { sendSMS } = require("../query/sms");
const { _toSQLTime } = require("../common/time");
// const { _registerNewLicense } = require("./license");

const AUTH_USER_COLUMNS = ["email", "username", "password", "is_superuser", "is_staff", "first_name", "last_name", "is_active", "date_joined"];
const AUTH_USERPROFILE_COLUMNS = [
  "user_id",
  "name",
  "meta",
  "courseware",
  "language",
  "location",
  "year_of_birth",
  "gender",
  "level_of_education",
  "mailing_address",
  "country",
  "state",
  "city",
  "allow_certificate",
  "bio",
  "profile_image_uploaded_at",
  "phone_number",
  "company",
  "func",
  "linkedin",
  "twitter",
  "facebook",
  "ssn_number",
  "postal_code",
  "role",
  "university",
  "degree",
  "skills",
  "term_accepted",
  "fax",
  "website",
  "legal_form",
  "capital",
  "activity_declaration_number",
  "region",
  "ape_code",
  "siret_number",
  "signature_url",
  "avatar",
  "cover",
  "email_announce",
  "email_reminder",
  "email_comment",
  "sms_announce",
  "sms_reminder",
  "sms_comment",
  "phone_announce",
  "phone_resume",
];

const encode = (password, { algorithm, salt, iterations }) => {
  if (algorithm && salt && iterations) {
    const hash = crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256");
    return `${algorithm}$${iterations}$${salt}$${hash.toString("base64")}`;
  }
  return "";
};
const decode = (encoded) => {
  const [algorithm, iterations, salt, hash] = encoded.split("$");
  return {
    algorithm,
    hash,
    iterations: parseInt(iterations, 10),
    salt,
  };
};

// From raw 'password' and hash 'encoded', see if those are same in hash, and generate new password hash
exports.verifyAndGenerate = (password, encoded, newPassword) => {
  const decoded = decode(encoded);
  const encodedOldPassword = encode(password, decoded);
  const newShaPassword = newPassword ? encode(newPassword, decoded) : "";
  return { flag: encoded === encodedOldPassword, sha256Pwd: newShaPassword };
};

exports.addLoginHistory = async (_, obj, ctx) => {
  const { permission, ip, device, browser } = ctx;
  if (permission != "TESTUSER") return { success: false };

  const sqlAppClient = _getSQLAppClient();

  try {
    const { email, password } = obj;

    // Get user id from user email ------------------------------------------------------------------------------------
    let query = `
      SELECT A.id, A.password, A.is_superuser, A.is_staff, A.is_active, IF(B.state = 'granted', 1, 0) as is_admin
      FROM auth_user A
        LEFT JOIN course_creators_coursecreator B ON A.id=B.user_id
      WHERE A.email='${email}'`;
    let res = await sqlAppClient.query(query);

    const user = res.length > 0 ? res[0] : null;
    if (!user || !user.is_active) throw Error("User not exist!");

    const { flag } = this.verifyAndGenerate(password, user.password, "data13");
    if (!flag) throw Error("Password does not match!");

    // Update course viewed count across all enrolled courses of this user
    query = `UPDATE student_courseenrollment SET view_count = view_count + 1 WHERE user_id=${user.id} AND is_active=1`;
    res = await sqlAppClient.query(query);

    // Update login history in Mongo ------------------------------------------
    await editLoginHist(user.id, ip, device, browser);

    // Generate user token
    const permission = user.is_superuser ? "SUPERADMIN" : user.is_staff ? "STAFF" : user.is_admin ? "ADMIN" : "USER";
    const jwtToken = jwt.sign(
      {
        id: user.id,
        permission: permission,
        expired: 60 * 60 * 24,
        is_ghost: false,
      },
      JWTSECRET,
      { algorithm: "HS256" }
    );

    return { success: true, jwt: jwtToken, permission };
  } catch (e) {
    console.log("[error]", e);

    return { success: false };
  } finally {
    sqlAppClient.quit();
  }
};

exports.registerUser = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return null;
  const sqlAppClient = _getSQLAppClient();

  let query = "",
    res = "";
  const currSQLDate = _toSQLTime(new Date());

  try {
    const userInputs = obj.input;

    const userdata = {};
    userInputs.forEach(({ name, value }) => (userdata[name] = value));
    if (!userdata.email || !userdata.username) throw Error("Not enough user inputs");

    query = `SELECT id, username, email FROM auth_user WHERE username = '${userdata.username}' OR email = '${userdata.email}'`;
    res = await sqlAppClient.query(query);
    if (res.length) {
      res = res[0];
      if (res.email == userdata.email) throw Error("email exist");
      if (res.username == userdata.username) throw Error("user exist");
    }

    // Generate Password hash
    const finalPwd = permission == "ADMIN" || !userdata.password || !userdata.password.trim() ? _generateRandomPwd(8) : userdata.password;
    const { sha256Pwd } = this.verifyAndGenerate("", process.env.TEST_PWD_HASH, finalPwd);
    // pwdHash = sha256Pwd;
    userdata.password = sha256Pwd;
    userdata.date_joined = currSQLDate;
    userdata.is_active = 1;
    userdata.is_superuser = 0;
    userdata.is_staff = userdata.permission == "STAFF" ? 1 : 0;
    userdata.is_admin = userdata.permission == "ADMIN" ? 1 : 0;

    query = _getSQLQuery("insert", "auth_user", AUTH_USER_COLUMNS, userdata);
    res = await sqlAppClient.query(query);
    const insertId = res.insertId;

    query = "";
    if (permission === "SUPERADMIN" && !userdata.is_staff && userdata.is_admin) {
      query += `INSERT INTO course_creators_coursecreator (state_changed, state, note, user_id) VALUES ('${currSQLDate}', 'granted', "", ${insertId});`;
    }
    query += `INSERT INTO auth_registration (activation_key, user_id) VALUES ('${uuid.v4().replace(/-/g, "")}', ${insertId});`;
    query += `INSERT INTO user_api_userpreference (\`key\`, \`value\`, user_id) VALUES ('pref-lang', 'fr', ${insertId});`;

    userdata.user_id = insertId;
    userdata.name = userdata.username;
    userdata.meta = "";
    userdata.courseware = "";
    userdata.language = userdata.language || "";
    userdata.location = userdata.location || "";
    userdata.allow_certificate = 1;
    userdata.year_of_birth = Number(userdata.year_of_birth) || null;

    query += _getSQLQuery("insert", "auth_userprofile", AUTH_USERPROFILE_COLUMNS, userdata);
    await sqlAppClient.query(query);

    await sqlAppClient.query(`
      INSERT INTO user_api_userpreference (\`key\`, \`value\`, user_id) 
      VALUES ('pref-lang', 'fr', ${insertId})
      ON DUPLICATE KEY UPDATE \`value\` = 'fr';
    `);

    // Now send email to the user/admin // ****************************************************************
    const notifyType = "user_registered";
    query = `
      SELECT admin_email, subject, content, schedule, end_user FROM email_template WHERE type='${notifyType}' AND enabled=1 AND end_user='user';
      SELECT content FROM sms_template WHERE type='${notifyType}' AND enabled=1;
    `;
    res = await sqlAppClient.query(query);

    if (res[0].length) {
      const emailObj = res[0][0];
      const endUserHtml = emailObj.content;
      const subject = emailObj.subject;
      const adminEmail = emailObj.admin_email ? emailObj.admin_email : process.env.REACT_APP_CONTACT_EMAIL;

      const values = {
        PLATFORM_NAME: process.env.REACT_APP_SITE_DISPLAY_NAME,
        SURNAME: userdata.first_name || userdata.username,
        NAME: userdata.last_name,
        USER_ID: userdata.email,
        USER_PASSWORD: finalPwd,
        ADMIN_EMAIL: adminEmail,
        LOGIN_LINK: process.env.REACT_APP_AUTH_ENDPOINT,
        CURRENT_DATE: new Date().toISOString(),
      };

      console.log("[### register user pwd ###]", finalPwd, userdata.email);
      await sendEmail(notifyType, userdata.email, _fillHTMLTemplate(subject, values), _fillHTMLTemplate(endUserHtml, values));
    }

    if (res[1].length && userdata.phone_number) {
      const smsObj = res[1][0];
      const content = smsObj.content;

      const values = {
        PLATFORM_NAME: process.env.REACT_APP_SITE_DISPLAY_NAME,
        NAME: userdata.first_name || userdata.username,
        SURNAME: userdata.last_name,
        USER_ID: userdata.email,
        USER_PASSWORD: finalPwd,
      };

      sendSMS(notifyType, userdata.phone_number, _fillHTMLTemplate(content, values));
    }

    // ***************************************************************************************************

    return { insertId: insertId, errorCode: 0 }; // 0 none
  } catch (e) {
    console.log("[register User Err]", e);
    if (e == "Error: email exist") return { insertId: null, errorCode: 1 }; // 1 email
    if (e == "Error: user exist") return { insertId: null, errorCode: 2 }; // 2 user
    return { insertId: null, errorCode: 3 }; // Other
  } finally {
    sqlAppClient.quit();
  }
};

exports.registerBulkUsers = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return null;

  const sqlAppClient = _getSQLAppClient();

  let query = "",
    res = "";
  const currSQLDate = _toSQLTime(new Date());

  try {
    const userInputs = obj.input;
    let usersdata = [];
    for (let item of userInputs) {
      const userdata = {};
      for (let { name, value } of item) userdata[name] = value;
      if (!userdata.email || !userdata.username) continue;
      if (usersdata.find((v) => v.email == userdata.email || v.username == userdata.username)) continue;
      usersdata.push(userdata);
    }

    query = `
      SELECT id, username, email 
      FROM auth_user 
      WHERE username IN (${usersdata.map((v) => '"' + v.username + '"')}) OR email IN (${usersdata.map((v) => '"' + v.email + '"')})`;
    res = await sqlAppClient.query(query);
    usersdata = usersdata.filter((v) => !res.find((vt) => vt.email == v.email) && !res.find((vt) => vt.username == v.username));

    if (!usersdata.length) return { total: userInputs.length, possible: 0 };

    // Add password fields
    query = "";
    for (let i = 0; i < usersdata.length; i++) {
      const finalPwd = permission == "ADMIN" || !usersdata[i].password || !usersdata[i].password.trim() ? _generateRandomPwd(8) : usersdata[i].password;
      const { sha256Pwd } = this.verifyAndGenerate("", process.env.TEST_PWD_HASH, finalPwd);
      usersdata[i].password = sha256Pwd;
      usersdata[i].password_raw = finalPwd;
      usersdata[i].date_joined = currSQLDate;
      usersdata[i].is_active = 1;
      usersdata[i].is_superuser = 0;
      usersdata[i].is_staff = usersdata[i].permission == "STAFF" ? 1 : 0;
      usersdata[i].is_admin = usersdata[i].permission == "ADMIN" ? 1 : 0;

      query += _getSQLQuery("insert", "auth_user", AUTH_USER_COLUMNS, usersdata[i]);
    }
    res = await sqlAppClient.query(query);
    const { insertId } = res.length ? res[0] : res;

    query = "";
    for (let i = 0; i < usersdata.length; i++) {
      const currUserId = insertId + i;
      if (permission === "SUPERADMIN" && !usersdata[i].is_staff && usersdata[i].is_admin) {
        query += `INSERT INTO course_creators_coursecreator (state_changed, state, note, user_id) VALUES ('${currSQLDate}', 'granted', "", ${currUserId});`;
      }
      query += `INSERT INTO auth_registration (activation_key, user_id) VALUES ('${uuid.v4().replace(/-/g, "")}', ${currUserId});`;
      query += `INSERT INTO user_api_userpreference (\`key\`, \`value\`, user_id) VALUES ('pref-lang', 'fr', ${currUserId}) ON DUPLICATE KEY UPDATE \`value\` = 'fr';`;

      usersdata[i].user_id = currUserId;
      usersdata[i].name = usersdata[i].username;
      usersdata[i].meta = "";
      usersdata[i].courseware = "";
      usersdata[i].language = usersdata[i].language || "";
      usersdata[i].location = usersdata[i].location || "";
      usersdata[i].allow_certificate = 1;
      usersdata[i].year_of_birth = Number(usersdata[i].year_of_birth) || null;
      query += _getSQLQuery("insert", "auth_userprofile", AUTH_USERPROFILE_COLUMNS, usersdata[i]);
    }
    await sqlAppClient.query(query);

    // Now send email to the user/admin // ****************************************************************
    const notifyType = "user_registered";
    query = `
      SELECT admin_email, content, schedule, end_user FROM email_template WHERE type='${notifyType}' AND enabled=1 AND end_user='user';
      SELECT content FROM sms_template WHERE type='${notifyType}' AND enabled=1;
    `;
    res = await sqlAppClient.query(query);

    if (res[0].length) {
      const emailObj = res[0][0];
      const endUserHtml = emailObj.content;
      const subject = emailObj.subject;
      const adminEmail = emailObj.admin_email ? emailObj.admin_email : process.env.REACT_APP_CONTACT_EMAIL;

      for (let { username, email, password_raw } of usersdata) {
        const values = {
          PLATFORM_NAME: process.env.REACT_APP_SITE_DISPLAY_NAME,
          SURNAME: username,
          NAME: "",
          USER_ID: email,
          USER_PASSWORD: password_raw,
          ADMIN_EMAIL: adminEmail,
          LOGIN_LINK: process.env.REACT_APP_AUTH_ENDPOINT,
          CURRENT_DATE: new Date().toISOString(),
        };

        console.log("[### bulk user register ###]", email, password_raw);
        await sendEmail(notifyType, email, _fillHTMLTemplate(subject, values), _fillHTMLTemplate(endUserHtml, values));
      }
    }

    if (res[1].length) {
      const smsObj = res[1][0];
      const content = smsObj.content;

      for (let { username, email, password_raw, last_name, phone_number } of usersdata) {
        if (!phone_number) continue;
        const values = {
          PLATFORM_NAME: process.env.REACT_APP_SITE_DISPLAY_NAME,
          SURNAME: username,
          NAME: last_name,
          USER_ID: email,
          USER_PASSWORD: password_raw,
        };

        sendSMS(notifyType, phone_number, _fillHTMLTemplate(content, values));
      }
    }
    // ***************************************************************************************************

    return { first_user_id: insertId, total: userInputs.length, possible: usersdata.length };
  } catch (e) {
    console.log("[Edit Bulk User Err]", e);
    return { total: 0, possible: 0 };
  } finally {
    sqlAppClient.quit();
  }
};

exports.editRegisteredUserPwd = async (_, obj, ctx) => {
  const { userId, permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return false;

  const sqlAppClient = _getSQLAppClient();

  let finalPwd = "",
    res = "";

  try {
    const { user_id, new_password } = obj;

    finalPwd = new_password;

    if (userId == user_id) throw Error("userid is self");

    let cond = "";
    // let username = '';
    let firstName = "";
    let lastName = "";
    let userEmail = "";
    let userPhone = "";

    let user = await sqlAppClient.query(`
      SELECT A.first_name, A.last_name, A.username, A.password, A.is_superuser, A.is_staff, A.email, B.state, C.phone_number
      FROM auth_user AS A
        LEFT JOIN course_creators_coursecreator AS B ON A.id = B.user_id 
        LEFT JOIN auth_userprofile C ON A.id = C.user_id
      WHERE A.id = ${user_id}
    `);

    if (user && user.length) {
      user = user[0];
      const dbPwd = user["password"];
      userEmail = user["email"];
      userPhone = user["phone_number"];
      // username = user.first_name || user.last_name ? `${user.first_name} ${user.last_name}` : user.username;

      firstName = user.first_name || user.username;
      lastName = user.last_name;

      // We will give permission only who is prior to the student role
      const studentPermission = user.is_superuser ? "SUPERADMIN" : user.is_staff ? "STAFF" : user.state == "granted" ? "ADMIN" : "USER";
      const permissionList = ["SUPERADMIN", "STAFF", "ADMIN", "USER"];

      if (permission == "ADMIN") finalPwd = _generateRandomPwd(8);

      const { sha256Pwd } = finalPwd ? this.verifyAndGenerate("", dbPwd, finalPwd) : {};

      if (permission == "SUPERADMIN" || permissionList.indexOf(permission) < permissionList.indexOf(studentPermission)) {
        cond += sha256Pwd ? ` ,password = '${sha256Pwd}'` : "";
      } else {
        throw Error("Permission Denied to change password!");
      }
    }

    let query = cond ? `UPDATE auth_user SET ${cond.substring(2)} WHERE id = ${user_id};` : "";

    if (query) {
      await sqlAppClient.query(query);
    }

    // Now send email to the user for password change // ****************************************************************
    const notifyType = "password_changed";
    query = `
      SELECT admin_email, subject, content, schedule, end_user FROM email_template WHERE type='${notifyType}' AND enabled=1 AND end_user='user';
      SELECT content FROM sms_template WHERE type='${notifyType}' AND enabled=1;
    `;
    res = await sqlAppClient.query(query);

    if (res[0].length) {
      const emailObj = res[0][0];
      const endUserHtml = emailObj.content;
      const subject = emailObj.subject;
      const adminEmail = emailObj.admin_email ? emailObj.admin_email : process.env.REACT_APP_CONTACT_EMAIL;

      const values = {
        PLATFORM_NAME: process.env.REACT_APP_SITE_DISPLAY_NAME,
        SURNAME: firstName,
        NAME: lastName,
        USER_ID: userEmail,
        USER_PASSWORD: finalPwd,
        ADMIN_EMAIL: adminEmail,
        LOGIN_LINK: process.env.REACT_APP_AUTH_ENDPOINT,
        CURRENT_DATE: new Date().toISOString(),
      };

      console.log("[editRegisteredUserPwd]", finalPwd, userEmail);

      await sendEmail(notifyType, userEmail, _fillHTMLTemplate(subject, values), _fillHTMLTemplate(endUserHtml, values));
    }

    if (res[1].length && userPhone) {
      const smsObj = res[1][0];
      const content = smsObj.content;

      const values = {
        PLATFORM_NAME: process.env.REACT_APP_SITE_DISPLAY_NAME,
        NAME: firstName,
        SURNAME: lastName,
        USER_ID: userEmail,
        USER_PASSWORD: finalPwd,
      };

      sendSMS(notifyType, userPhone, _fillHTMLTemplate(content, values));
    }

    return query ? true : false;
  } catch (e) {
    console.log("[Edit User Err]", e);
    return false;
  } finally {
    sqlAppClient.quit();
  }
};

exports.editRegisteredUser = async (_, obj, ctx) => {
  const { userId, permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return false;

  const sqlAppClient = _getSQLAppClient();
  const currSQLDate = _toSQLTime(new Date());

  let emailShouldUpdate = false;
  const { user_id, input: userInputs } = obj;

  try {
    if (userId == user_id) return "";

    let query = "",
      res = "";

    let userdata = {};
    userInputs.forEach(({ name, value }) => (userdata[name] = value));

    if (userdata.email) {
      query = `SELECT id, username, email FROM auth_user WHERE email = '${userdata.email}'`;
      res = await sqlAppClient.query(query);
      res = res.length ? res[0] : {};

      if (res.email == userdata.email && res.id != user_id) throw Error("Email exist");
      emailShouldUpdate = !res.email;
    }

    if (emailShouldUpdate) {
      const finalPwd = permission == "ADMIN" || !userdata.password || !userdata.password.trim() ? _generateRandomPwd(8) : userdata.password;
      const { sha256Pwd } = this.verifyAndGenerate("", process.env.TEST_PWD_HASH, finalPwd);
      // pwdHash = sha256Pwd;
      userdata.password = sha256Pwd;
      userdata.password_raw = finalPwd;
    } else {
      delete userdata.password;
    }
    delete userdata.username;
    delete userdata.is_superuser;

    userdata = {
      ...userdata,
      ...(userdata.is_active ? { is_active: userdata.is_active == "true" } : {}),
      ...(userdata.email_announce ? { email_announce: userdata.email_announce == "true" } : {}),
      ...(userdata.email_reminder ? { email_reminder: userdata.email_reminder == "true" } : {}),
      ...(userdata.email_comment ? { email_comment: userdata.email_comment == "true" } : {}),
      ...(userdata.sms_announce ? { sms_announce: userdata.sms_announce == "true" } : {}),
      ...(userdata.sms_reminder ? { sms_reminder: userdata.sms_reminder == "true" } : {}),
      ...(userdata.sms_comment ? { sms_comment: userdata.sms_comment == "true" } : {}),
      ...(userdata.phone_announce ? { phone_announce: userdata.phone_announce == "true" } : {}),
      ...(userdata.phone_resume ? { phone_resume: userdata.phone_resume == "true" } : {}),
      ...(userdata.permission === "STAFF" ? { is_staff: true } : userdata.permission ? { is_staff: false } : {}),
      ...(userdata.permission === "ADMIN" ? { is_admin: true } : userdata.permission ? { is_admin: false } : {}),
      ...(userdata.year_of_birth ? { year_of_birth: Number(userdata.year_of_birth) } : {}),
    };

    query = _getSQLQuery("update", "auth_user", AUTH_USER_COLUMNS, userdata, `id = ${user_id};`);

    if (permission === "SUPERADMIN") {
      // Admin setting
      query +=
        userdata.is_admin == true
          ? `
        INSERT INTO course_creators_coursecreator (state_changed, state, note, user_id) 
        VALUES ('${currSQLDate}', 'granted', "", ${user_id}) 
        ON DUPLICATE KEY UPDATE state = 'granted';
      `
          : "";

      query += userdata.is_admin == false ? `DELETE FROM course_creators_coursecreator WHERE user_id = ${user_id};` : "";
    }

    const currProfile = await sqlAppClient.query(`SELECT id FROM auth_userprofile WHERE user_id=${user_id};`);
    if (currProfile.length) {
      query += _getSQLQuery("update", "auth_userprofile", AUTH_USERPROFILE_COLUMNS, userdata, `user_id = ${user_id};`);
    } else {
      userdata.user_id = user_id;
      userdata.name = userdata.email || "";
      userdata.meta = "";
      userdata.courseware = "";
      userdata.language = "fr";
      userdata.location = "";
      userdata.allow_certificate = false;
      query += _getSQLQuery("insert", "auth_userprofile", AUTH_USERPROFILE_COLUMNS, userdata);
    }

    await sqlAppClient.query(query);

    // Now send email to the user for password change // ****************************************************************
    if (emailShouldUpdate) {
      const emailType = "password_changed";
      query = `SELECT admin_email, subject, content, schedule, end_user FROM email_template WHERE type='${emailType}' AND enabled=1 AND end_user='user'`;
      res = await sqlAppClient.query(query);

      if (res && res.length) {
        res = res[0];
        const endUserHtml = res.content;
        const subject = res.subject;
        const adminEmail = res.admin_email ? res.admin_email : process.env.REACT_APP_CONTACT_EMAIL;

        const values = {
          PLATFORM_NAME: process.env.REACT_APP_SITE_DISPLAY_NAME,
          SURNAME: userdata.first_name,
          NAME: userdata.last_name,
          USER_ID: userdata.email,
          USER_PASSWORD: userdata.password_raw,
          ADMIN_EMAIL: adminEmail,
          LOGIN_LINK: process.env.REACT_APP_AUTH_ENDPOINT,
          CURRENT_DATE: new Date().toISOString(),
        };

        console.log("[editRegisteredUser]", userdata.password_raw, userdata.email);

        if (endUserHtml) await sendEmail(emailType, userdata.email, _fillHTMLTemplate(subject, values), _fillHTMLTemplate(endUserHtml, values));
      }
    }

    return true;
  } catch (e) {
    console.log("[Edit User Err]", e);
    if (e == "Error: email exist") return "EMAIL EXIST"; // 1 email
    return false;
  } finally {
    sqlAppClient.quit();
  }
};

exports.editUser = async (_, obj, ctx) => {
  // const { userId, permission } = ctx;
  const { userId, permission, is_ghost } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN", "USER"].indexOf(permission) < 0 || is_ghost) return false;

  const sqlAppClient = _getSQLAppClient();
  const userInputs = obj.input;

  let res = "",
    query = "";

  try {
    let userdata = {};
    userInputs.forEach(({ name, value }) => (userdata[name] = value));

    query = `SELECT id, email, password FROM auth_user WHERE id = ${userId};`;
    query += userdata.email ? `SELECT id, username, email FROM auth_user WHERE email = '${userdata.email}' AND id <> ${userId}` : "";
    res = await sqlAppClient.query(query);

    const dbPwd = res.length === 2 ? res[0][0].password : null;
    const isEmailExist = res.length === 2 ? !!res[1].length : false;

    if (isEmailExist) throw Error("Email exist");

    const email = userdata.email;
    delete userdata.email; // Email will only be changed when password is given

    if (userdata.old_password && userdata.password) {
      const { flag, sha256Pwd } = this.verifyAndGenerate(userdata.old_password, dbPwd, userdata.password);
      userdata.password_raw = userdata.password;
      if (flag) {
        userdata.password = sha256Pwd;
        userdata.email = email;
      } else {
        delete userdata.password;
        throw Error("Password does not match");
      }
    } else {
      delete userdata.password;
    }
    delete userdata.username;
    delete userdata.is_superuser;
    delete userdata.permission;

    userdata = {
      ...userdata,
      ...(userdata.year_of_birth ? { year_of_birth: Number(userdata.year_of_birth) } : {}),
      ...(userdata.term_accepted ? { term_accepted: userdata.term_accepted == "true" } : {}),
      ...(userdata.email_announce ? { email_announce: userdata.email_announce == "true" } : {}),
      ...(userdata.email_reminder ? { email_reminder: userdata.email_reminder == "true" } : {}),
      ...(userdata.email_comment ? { email_comment: userdata.email_comment == "true" } : {}),
      ...(userdata.sms_announce ? { sms_announce: userdata.sms_announce == "true" } : {}),
      ...(userdata.sms_reminder ? { sms_reminder: userdata.sms_reminder == "true" } : {}),
      ...(userdata.sms_comment ? { sms_comment: userdata.sms_comment == "true" } : {}),
      ...(userdata.phone_announce ? { phone_announce: userdata.phone_announce == "true" } : {}),
      ...(userdata.phone_resume ? { phone_resume: userdata.phone_resume == "true" } : {}),
    };

    query = _getSQLQuery("update", "auth_user", AUTH_USER_COLUMNS, userdata, `id = ${userId};`);
    query += _getSQLQuery("update", "auth_userprofile", AUTH_USERPROFILE_COLUMNS, userdata, `user_id = ${userId};`);

    await sqlAppClient.query(query);

    return true;
  } catch (e) {
    console.log("[Edit User Err]", e);

    return false;
  } finally {
    sqlAppClient.quit();
  }
};

exports._deleteUser = async (sqlAppClient, userId) => {
  let query = `
    SELECT A.email, B.id
    FROM auth_user A 
      LEFT JOIN auth_userprofile B ON B.user_id = A.id
    WHERE A.id = ${userId}`;
  let res = await sqlAppClient.query(query);

  if (!res || res.length == 0) throw Error("Not found");

  res = res[0];

  if (SYSTEM_USERS.indexOf(res.email) >= 0) throw Error("Danger Users");

  const user_profile_id = res.id ? res.id : -1;

  if (user_profile_id >= 0) {
    query = `
    DELETE FROM zoom_meeting_userprofilerole WHERE user_profile_id = ${user_profile_id};
    DELETE FROM student_sociallink WHERE user_profile_id = ${user_profile_id};
    DELETE FROM student_languageproficiency WHERE user_profile_id =${user_profile_id};

    DELETE FROM student_sociallink WHERE user_profile_id =${user_profile_id};
  `;
    res = await sqlAppClient.query(query);
  }

  // For our license data, we don't delete this table
  // DELETE B, A
  //   FROM student_courseenrollment A
  //     LEFT JOIN schedules_schedule B ON B.enrollment_id = A.id
  //   WHERE A.user_id = ${userId};

  query = `
    SET SESSION foreign_key_checks=OFF;

    DELETE FROM auth_userprofile WHERE user_id = ${userId};
    DELETE FROM auth_registration WHERE user_id = ${userId};
    DELETE FROM oauth2_provider_refreshtoken WHERE user_id = ${userId};
    DELETE FROM oauth2_provider_accesstoken WHERE user_id = ${userId};
    DELETE FROM student_anonymoususerid WHERE user_id = ${userId};
    DELETE FROM student_userattribute WHERE user_id = ${userId};
    DELETE FROM user_api_userpreference WHERE user_id = ${userId};

    DELETE B, A
    FROM oauth2_provider_application A
      LEFT JOIN oauth2_provider_accesstoken B ON B.application_id = A.id
    WHERE A.user_id = ${userId};

    DELETE B, A
    FROM courseware_studentmodule A
      LEFT JOIN courseware_studentmodulehistory B ON B.student_module_id = A.id
    WHERE A.student_id = ${userId};
    
    DELETE FROM student_loginfailures WHERE user_id=${userId};
    DELETE FROM certificates_certificatewhitelist WHERE user_id=${userId};
    DELETE FROM django_comment_client_role_users WHERE user_id=${userId};
    DELETE FROM experiments_experimentdata WHERE user_id=${userId};
    DELETE FROM admin_panel_courserunenrollment WHERE user_id=${userId};
    DELETE FROM admin_panel_siteadmin WHERE user_id=${userId};
    DELETE FROM admin_panel_usergroup WHERE user_id=${userId};
    DELETE FROM assessment_peerworkflow WHERE student_id=${userId};
    DELETE FROM assessment_studenttrainingworkflow WHERE student_id=${userId};
    DELETE FROM auth_accountrecovery WHERE user_id=${userId};
    DELETE FROM auth_user_groups WHERE user_id=${userId};
    DELETE FROM auth_user_user_permissions WHERE user_id=${userId};
    DELETE FROM badges_badgeassertion WHERE user_id=${userId};
    DELETE FROM bookmarks_bookmark WHERE user_id=${userId};
    DELETE FROM bulk_email_optout WHERE user_id=${userId};
    DELETE FROM bulk_grades_scoreoverrider WHERE user_id=${userId};
    DELETE FROM calendar_sync_historicalusercalendarsyncconfig WHERE user_id=${userId};
    DELETE FROM calendar_sync_usercalendarsyncconfig WHERE user_id=${userId};
    DELETE FROM completion_blockcompletion WHERE user_id=${userId};
    DELETE FROM content_libraries_contentlibrarypermission WHERE user_id=${userId};
    DELETE FROM course_creators_coursecreator WHERE user_id=${userId};
    DELETE FROM course_goals_coursegoal WHERE user_id=${userId};
    DELETE FROM course_groups_cohortmembership WHERE user_id=${userId};
    DELETE FROM course_groups_courseusergroup_users WHERE user_id=${userId};
    DELETE FROM courseware_offlinecomputedgrade WHERE user_id=${userId};
    DELETE FROM courseware_studentfieldoverride WHERE student_id=${userId};
    DELETE FROM courseware_xmodulestudentinfofield WHERE student_id=${userId};
    DELETE FROM courseware_xmodulestudentprefsfield WHERE student_id=${userId};
    DELETE FROM customization_userfeedback WHERE user_id=${userId};
    DELETE FROM demographics_historicaluserdemographics WHERE user_id=${userId};
    DELETE FROM demographics_userdemographics WHERE user_id=${userId};
    DELETE FROM django_admin_log WHERE user_id=${userId};
    DELETE FROM edx_when_userdate WHERE user_id=${userId};
    DELETE FROM enterprise_enterpriseanalyticsuser WHERE analytics_user_id=${userId};
    DELETE FROM enterprise_enterprisefeatureuserroleassignment WHERE user_id=${userId};
    DELETE FROM enterprise_historicalpendingenrollment WHERE user_id=${userId};
    DELETE FROM enterprise_pendingenrollment WHERE user_id=${userId};
    DELETE FROM enterprise_systemwideenterpriseuserroleassignment WHERE user_id=${userId};
    DELETE FROM entitlements_courseentitlement WHERE user_id=${userId};
    DELETE FROM entitlements_historicalcourseentitlement WHERE user_id=${userId};
    DELETE FROM experiments_experimentdata WHERE user_id=${userId};
    DELETE FROM external_user_ids_externalid WHERE user_id=${userId};
    DELETE FROM external_user_ids_historicalexternalid WHERE user_id=${userId};
    DELETE FROM grades_persistentcoursegrade WHERE user_id=${userId};
    DELETE FROM grades_persistentsubsectiongrade WHERE user_id=${userId};
    DELETE FROM lti_consumer_ltiagsscore WHERE user_id=${userId};
    DELETE FROM milestones_usermilestone WHERE user_id=${userId};
    DELETE FROM notify_settings WHERE user_id=${userId};
    DELETE FROM oauth2_provider_grant WHERE user_id=${userId};
    DELETE FROM organizations_historicalorganization WHERE history_user_id=${userId};
    DELETE FROM organizations_historicalorganizationcourse WHERE history_user_id=${userId};
    DELETE FROM proctoring_proctoredexamsoftwaresecurereview WHERE student_id=${userId};
    DELETE FROM proctoring_proctoredexamsoftwaresecurereviewhistory WHERE student_id=${userId};
    DELETE FROM proctoring_proctoredexamstudentallowance WHERE user_id=${userId};
    DELETE FROM proctoring_proctoredexamstudentallowancehistory WHERE user_id=${userId};
    DELETE FROM proctoring_proctoredexamstudentattempt WHERE user_id=${userId};
    DELETE FROM proctoring_proctoredexamstudentattempthistory WHERE user_id=${userId};
    DELETE FROM program_enrollments_historicalprogramenrollment WHERE user_id=${userId};
    DELETE FROM program_enrollments_programenrollment WHERE user_id=${userId};
    DELETE FROM social_auth_usersocialauth WHERE user_id=${userId};
    DELETE FROM student_anonymoususerid WHERE user_id=${userId};
    DELETE FROM student_courseaccessrole WHERE user_id=${userId};
    DELETE FROM student_courseenrollmentallowed WHERE user_id=${userId};
    DELETE FROM student_entranceexamconfiguration WHERE user_id=${userId};
    DELETE FROM student_loginfailures WHERE user_id=${userId};
    DELETE FROM student_pendingemailchange WHERE user_id=${userId};
    DELETE FROM student_pendingnamechange WHERE user_id=${userId};
    DELETE FROM student_pendingsecondaryemailchange WHERE user_id=${userId};
    DELETE FROM student_userattribute WHERE user_id=${userId};
    DELETE FROM student_usercelebration WHERE user_id=${userId};
    DELETE FROM student_userpasswordtogglehistory WHERE user_id=${userId};
    DELETE FROM student_userquizresult WHERE user_id=${userId};
    DELETE FROM student_usersignupsource WHERE user_id=${userId};
    DELETE FROM student_userstanding WHERE user_id=${userId};
    DELETE FROM student_usertestgroup_users WHERE user_id=${userId};
    DELETE FROM super_csv_csvoperation WHERE user_id=${userId};
    DELETE FROM survey_surveyanswer WHERE user_id=${userId};
    DELETE FROM system_wide_roles_systemwideroleassignment WHERE user_id=${userId};
    DELETE FROM teams_courseteammembership WHERE user_id=${userId};
    DELETE FROM user_api_usercoursetag WHERE user_id=${userId};
    DELETE FROM user_api_userorgtag WHERE user_id=${userId};
    DELETE FROM user_api_userpreference WHERE user_id=${userId};
    DELETE FROM user_api_userretirementpartnerreportingstatus WHERE user_id=${userId};
    DELETE FROM user_api_userretirementrequest WHERE user_id=${userId};
    DELETE FROM user_api_userretirementstatus WHERE user_id=${userId};
    DELETE FROM user_tasks_usertaskstatus WHERE user_id=${userId};
    DELETE FROM verify_student_manualverification WHERE user_id=${userId};
    DELETE FROM verify_student_softwaresecurephotoverification WHERE user_id=${userId};
    DELETE FROM verify_student_ssoverification WHERE user_id=${userId};
    DELETE FROM waffle_flag_users WHERE user_id=${userId};
    DELETE FROM wiki_articlerevision WHERE user_id=${userId};
    DELETE FROM wiki_revisionpluginrevision WHERE user_id=${userId};
    DELETE FROM xapi_xapilearnerdatatransmissionaudit WHERE user_id=${userId};
    DELETE FROM zoom_meeting_mettingattend WHERE user_id=${userId};
    DELETE FROM analytic_page_courseanalytic WHERE user_id=${userId};
    DELETE FROM auth_user WHERE id = ${userId};

    SET SESSION foreign_key_checks=ON;
  `;

  res = await sqlAppClient.query(query);
};

exports.deleteUser = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return false;

  const { user_id } = obj;

  const sqlAppClient = _getSQLAppClient();
  try {
    await this._deleteUser(sqlAppClient, user_id);

    return true;
  } catch (e) {
    console.log("[err]", e);
    return false;
  } finally {
    sqlAppClient.quit();
  }
};

exports.assignCoursesToUser = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return 0;

  const { user_id, course_ids } = obj;
  const sqlAppClient = _getSQLAppClient();

  let query = "",
    res = "";

  try {
    const nextYear = _toSQLTime(new Date(new Date().setFullYear(new Date().getFullYear() + 1)));

    query = `
        SELECT U.id, U.course_id, U.user_id
        FROM (
          SELECT *
          FROM student_courseenrollment 
          WHERE user_id = ${user_id}
        ) as U
          INNER JOIN (
            SELECT id
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
    const newCourseIds = [];
    for (let courseId of course_ids) {
      const idx = res.findIndex((r) => r.course_id == courseId && r.user_id == user_id);
      if (idx < 0) {
        newCourseIds.push(courseId);
      }
    }

    // For new assign items, evaluate license remaining, and add if available
    const remainingLicense = await _getAvailableLicenseNumber(sqlAppClient);
    const isNewCourseAssignAvailable = remainingLicense.license_available >= newCourseIds.length ? true : false;
    if (isNewCourseAssignAvailable) {
      // Build query string
      query = "";
      const currDate = _toSQLTime(new Date());
      for (let courseId of newCourseIds) {
        query += `('${courseId}', '${currDate}', 1, 'audit', ${user_id}, '${nextYear}'), `;
      }
      if (query) {
        query = query.slice(0, -2);
        query = `INSERT INTO student_courseenrollment (course_id, created, is_active, mode, user_id, end) VALUES ${query}`;
        await sqlAppClient.query(query);
      }
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

      query = `SELECT username, first_name, last_name, email FROM auth_user WHERE id=${user_id}`;
      res = await sqlAppClient.query(query);

      // If user exist
      if (res.length) {
        const student = res[0];

        query = "";
        if (isNewCourseAssignAvailable) {
          query = `SELECT display_name FROM course_overviews_courseoverview WHERE id IN (${course_ids.map((v) => '"' + v + '"')})`;
        } else {
          const updatedCourseIds = course_ids.filter((v) => !newCourseIds.includes(v));
          if (updatedCourseIds.length) {
            query = `SELECT display_name FROM course_overviews_courseoverview WHERE id IN (${updatedCourseIds.map((v) => '"' + v + '"')})`;
          }
        }
        res = query ? await sqlAppClient.query(query) : [];

        for (let i = 0; i < res.length; i++) {
          const values = {
            PLATFORM_NAME: process.env.REACT_APP_SITE_DISPLAY_NAME,
            SURNAME: student.first_name || student.username,
            NAME: student.last_name,
            USER_ID: student.email,
            COURSE_TITLE: res[i].display_name,
            ADMIN_EMAIL: adminEmail,
            LOGIN_LINK: process.env.REACT_APP_AUTH_ENDPOINT,
            CURRENT_DATE: new Date().toISOString(),
          };

          await sendEmail(emailType, student.email, _fillHTMLTemplate(subject, values), _fillHTMLTemplate(endUserHtml, values), res[i].display_name);
        }
      }
    }
    // ***************************************************************************************************

    return isNewCourseAssignAvailable ? course_ids.length : course_ids.length - newCourseIds.length;
  } catch (e) {
    console.log("[course assign Err]", e);

    return 0;
  } finally {
    sqlAppClient.quit();
  }
};

exports.updateEnrollDates = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return false;

  const sqlAppClient = _getSQLAppClient();

  const { course_id, user_id, run_end } = obj;
  try {
    const query = `
      UPDATE student_courseenrollment 
      SET end='${_toSQLTime(new Date(run_end))}'
      WHERE course_id='${course_id}' AND user_id=${user_id}
    `;
    await sqlAppClient.query(query);

    return true;
  } catch (e) {
    console.log("[update enroll date err]", e);
    return false;
  } finally {
    sqlAppClient.quit();
  }
};

exports.dismissCoursesFromUser = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return false;

  const { user_id, course_ids } = obj;

  const sqlAppClient = _getSQLAppClient();

  try {
    await sqlAppClient.query(`
      UPDATE student_courseenrollment 
      SET is_active = 0
      WHERE user_id = ${user_id} AND course_id IN (${course_ids.map((courseId) => '"' + courseId + '"')})
    `);

    return true;
  } catch (e) {
    console.log("[user Err]", e);

    return false;
  } finally {
    sqlAppClient.quit();
  }
};

exports.resetPassword = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN", "USER", "TESTUSER"].indexOf(permission) < 0) return false;

  const { user_id, password_hash, new_password } = obj;

  let query = "",
    res = "";
  const sqlAppClient = _getSQLAppClient();

  try {
    query = `
      SELECT id, password
      FROM auth_user
      WHERE id=${user_id} AND password_hash='${password_hash}'
    `;
    res = await sqlAppClient.query(query);
    if (!res || !res.length) throw Error("User not found!");
    res = res[0];

    const { sha256Pwd } = this.verifyAndGenerate("", res.password, new_password);

    query = `
      UPDATE auth_user
      SET password='${sha256Pwd}'
      WHERE id=${user_id}
    `;
    await sqlAppClient.query(query);

    return true;
  } catch (e) {
    console.log("[Password Reset]", e);
    return false;
  } finally {
    sqlAppClient.quit();
  }
};
