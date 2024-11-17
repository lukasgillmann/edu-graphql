const { _getSQLAppClient } = require("../common/utility");

exports._themeList = async (sqlHistClient) => {
  const query = "SELECT `name`, `value`, `default` FROM theme;";
  return await sqlHistClient.query(query);
};

exports.themeList = async (_, obj, ctx) => {
  const { permission } = ctx;

  if (["SUPERADMIN", "STAFF", "ADMIN", "USER", "TESTUSER"].indexOf(permission) < 0) return null;

  const sqlAppClient = _getSQLAppClient();

  try {
    return await this._themeList(sqlAppClient);
  } catch (e) {
    console.log("[error]", e);
    return null;
  } finally {
    sqlAppClient.quit();
  }
};
