const { _getMongoLogClient, _getSQLAppClient } = require("../common/utility");

exports._insertSMSLog = async (type, to) => {
  const mongoClient = await _getMongoLogClient();

  try {
    await mongoClient.db(process.env.MONGO_DB_INSPECT_NAME).collection("sms.log").insertOne({
      time: new Date(),
      type: type,
      to: to,
    });

    return true;
  } catch (e) {
    console.log("[err]", e);
    return false;
  } finally {
    mongoClient.close();
  }
};

exports.editSMSTemplate = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN", "USER"].indexOf(permission) < 0) return false;

  const sqlAppClient = _getSQLAppClient();

  try {
    const { id, type, enabled, content } = obj.input;

    let query = `
      SELECT id
      FROM sms_template
      WHERE id = ${id ? id : -1}
    `;

    let res = await sqlAppClient.query(query);
    query = "";

    if (res && res.length) {
      // update that item
      res = res[0];

      let cond = "";
      cond += type ? ` ,type = '${type}'` : "";
      cond += enabled != null ? ` ,enabled = ${enabled}` : "";
      cond += content != undefined ? ` ,content = '${content}'` : "";

      if (cond) {
        query = `
          UPDATE sms_template
          SET ${cond.substring(2)}
          WHERE id = ${id}
        `;
      }
    } else {
      // Insert new one
      query = `
        INSERT INTO sms_template (type, enabled, content) 
        VALUES ('${type}', ${enabled}, '${content}');
      `;
    }

    if (query) {
      res = await sqlAppClient.query(query);
    }

    return true;
  } catch (e) {
    console.log("[sms Err]", e);

    return false;
  } finally {
    sqlAppClient.quit();
  }
};
