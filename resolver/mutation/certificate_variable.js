const { _getSQLAppClient } = require("../common/utility");

exports.editCertificateVariable = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return false;

  const sqlAppClient = _getSQLAppClient();

  try {
    const { comment, location, phone_number, contact_email, siret_number, sign_top, sign_bottom } = obj.input;

    let res = "";

    let query = `SELECT * FROM certificate_variable;`;
    res = await sqlAppClient.query(query);

    query = "";

    if (res.length) {
      query += comment != undefined ? ` ,comment = '${comment.replace(/'/g, "\\'")}'` : "";
      query += location != undefined ? ` ,location = '${location.replace(/'/g, "\\'")}'` : "";
      query += phone_number != undefined ? ` ,phone_number = '${phone_number}'` : "";
      query += contact_email != undefined ? ` ,contact_email = '${contact_email}'` : "";
      query += siret_number != undefined ? ` ,siret_number = '${siret_number}'` : "";
      query += sign_top != undefined ? ` ,sign_top = '${sign_top.replace(/'/g, "\\'")}'` : "";
      query += sign_bottom != undefined ? ` ,sign_bottom = '${sign_bottom.replace(/'/g, "\\'")}'` : "";
      query = query.substring(2);

      if (query) {
        query = `UPDATE certificate_variable SET ${query} WHERE id=${res[0].id}`;
      }
    } else {
      query = `INSERT INTO certificate_variable 
        (comment, location, phone_number, contact_email, siret_number, sign_top, sign_bottom)
        VALUES 
          (
            '${comment ? comment : ""}', 
            '${location ? location : ""}', 
            '${phone_number ? phone_number : ""}', 
            '${contact_email ? contact_email : ""}', 
            '${siret_number ? siret_number : ""}', 
            '${sign_top ? sign_top : ""}', 
            '${sign_bottom ? sign_bottom : ""}'
          )
      `;
    }

    if (query) {
      res = await sqlAppClient.query(query);
    }

    return true;
  } catch (e) {
    console.log("[Edit tutor Err]", e);
    return false;
  } finally {
    sqlAppClient.quit();
  }
};

exports.deleteCertificateVariable = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return false;

  const rowId = obj.input;

  const sqlAppClient = _getSQLAppClient();

  try {
    await sqlAppClient.query(`
      DELETE FROM certificate_variable
      WHERE id = ${rowId};
    `);

    return true;
  } catch (e) {
    console.log("[err]", e);

    return false;
  } finally {
    sqlAppClient.quit();
  }
};
