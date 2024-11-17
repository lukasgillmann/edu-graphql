const { _getSQLAppClient } = require("../common/utility");

exports.editTerms = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return false;

  const sqlAppClient = _getSQLAppClient();

  try {
    const { content, enabled } = obj;

    let res = "",
      query = "";

    query = `SELECT id FROM terms`;
    res = await sqlAppClient.query(query);

    query = "";

    if (res && res.length) {
      query += content ? ` ,content = '${content.replace(/'/g, "\\'")}'` : "";
      query += enabled != null ? ` ,enabled = ${enabled}` : "";
      query = query.substring(2);
      query = `UPDATE terms SET ${query} WHERE id=${res[0].id}`;
    } else {
      query = `
        INSERT INTO terms (content, enabled)
          VALUES 
            (
              '${content ? content.replace(/'/g, "\\'") : ""}', 
              ${enabled ? true : false}
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
