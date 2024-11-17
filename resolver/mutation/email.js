const { _getZeroTime } = require("../common/time");
const { _getMongoLogClient, _getSQLAppClient } = require("../common/utility");

exports._insertEmailLog = async (type, to, courseTitle = "") => {
  const currDate = _getZeroTime(new Date().getTime());
  const currTime = new Date().getTime();

  const mongoClient = await _getMongoLogClient();
  try {
    await mongoClient.db(process.env.MONGO_DB_INSPECT_NAME).collection("email.log").insertOne({
      time: currTime,
      date: currDate,
      type: type,
      to: to,
      course: courseTitle,
    });

    return true;
  } catch (e) {
    console.log("[err]", e);
    return false;
  } finally {
    await mongoClient.close();
  }
};

exports.editEmailTemplate = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "ADMIN", "USER"].indexOf(permission) < 0) return false;

  const sqlAppClient = _getSQLAppClient();
  try {
    const { id, type, enabled, schedule, end_user, content, admin_email, subject } = obj.input;

    let query = `
      SELECT type, enabled, schedule, end_user
      FROM email_template
      WHERE id = ${id ? id : -1}
    `;

    let res = await sqlAppClient.query(query);
    query = "";

    if (res && res.length) {
      // update that item
      res = res[0];

      let cond = "";
      cond += type ? ` ,type = '${type}'` : "";
      cond += enabled != undefined ? ` ,enabled = ${enabled}` : "";
      cond += schedule ? ` ,schedule = '${schedule}'` : "";
      cond += end_user ? ` ,end_user = '${end_user}'` : "";
      cond += content != undefined ? ` ,content = '${content.replace(/'/g, "\\'")}'` : "";
      cond += admin_email != undefined ? ` ,admin_email = '${admin_email}'` : "";
      cond += subject != undefined ? ` ,subject = '${subject}'` : "";

      if (cond) {
        query = `
          UPDATE email_template
          SET ${cond.substring(2)}
          WHERE id = ${id}
        `;
      }
    } else {
      // Insert new one
      query = `
        INSERT INTO email_template (type, enabled, schedule, end_user, content, admin_email, subject) 
        VALUES ('${type}', ${enabled}, '${schedule}', '${end_user}', '${content}', '${admin_email}', '${subject}');
      `;
    }

    if (query) {
      res = await sqlAppClient.query(query);
    }

    return true;
  } catch (e) {
    console.log("[email Err]", e);
    return false;
  } finally {
    sqlAppClient.quit();
  }
};
