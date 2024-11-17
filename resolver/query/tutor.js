const { _getSQLAppClient } = require("../common/utility");

exports._tutorList = async (sqlAppClient, page, pageSize) => {
  let query = `
    SELECT id, first_name, last_name, email, phone_number, country, state, city, gender, bio, year_of_birth, avatar
    FROM virtual_tutor
    LIMIT ${page * pageSize}, ${pageSize};
    SELECT COUNT(*) AS total FROM virtual_tutor;
  `;

  let res = await sqlAppClient.query(query);
  const total = res[1][0].total;
  res = res[0];

  return { total, page, page_size: pageSize, data: res };
};

exports.tutorList = async (_, obj, ctx) => {
  const { permission } = ctx;

  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return null;

  const { page, page_size } = obj;

  const sqlAppClient = _getSQLAppClient();

  try {
    return await this._tutorList(sqlAppClient, page, page_size);
  } catch (e) {
    console.log("[error]", e);

    return null;
  } finally {
    sqlAppClient.quit();
  }
};
