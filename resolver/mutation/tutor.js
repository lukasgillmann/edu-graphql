const { _getSQLAppClient } = require("../common/utility");

exports.editTutor = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return null;

  const sqlAppClient = _getSQLAppClient();

  try {
    const { id, first_name, last_name, email, phone_number, country, state, city, gender, bio, year_of_birth, avatar } = obj.input;

    let res = "",
      query = "";

    if (id != null && id != undefined) {
      query = `SELECT * FROM virtual_tutor WHERE id=${id};`;
      res = await sqlAppClient.query(query);
    }

    query = "";

    if (res && res.length) {
      query += first_name != undefined ? ` ,first_name = '${first_name}'` : "";
      query += last_name != undefined ? ` ,last_name = '${last_name}'` : "";
      query += email != undefined ? ` ,email = '${email}'` : "";
      query += phone_number != undefined ? ` ,phone_number = '${phone_number}'` : "";
      query += country != undefined ? ` ,country = '${country}'` : "";
      query += state != undefined ? ` ,state = '${state}'` : "";
      query += city != undefined ? ` ,city = '${city}'` : "";
      query += gender != undefined ? ` ,gender = '${gender}'` : "";
      query += bio != undefined ? ` ,bio = '${bio}'` : "";
      query += year_of_birth != undefined ? ` ,year_of_birth = ${year_of_birth}` : "";
      query += avatar != undefined ? ` ,avatar = '${avatar}'` : "";
      query = query.substring(2);
      query = `UPDATE virtual_tutor SET ${query} WHERE id=${id}`;
    } else {
      query = `INSERT INTO virtual_tutor 
        (first_name, last_name, email, phone_number, country, state, city, gender, bio, year_of_birth, avatar)
        VALUES 
          (
            '${first_name ? first_name : ""}', 
            '${last_name ? last_name : ""}', 
            '${email ? email : ""}', 
            '${phone_number ? phone_number : ""}', 
            '${country ? country : ""}', 
            '${state ? state : ""}', 
            '${city ? city : ""}', 
            '${gender ? gender : ""}',
            '${bio ? bio : ""}', 
            ${year_of_birth ? year_of_birth : 1900}, 
            '${avatar ? avatar : ""}'
          )
      `;
    }

    if (query) {
      res = await sqlAppClient.query(query);
    }

    return res.insertId;
  } catch (e) {
    console.log("[Edit tutor Err]", e);

    return null;
  } finally {
    sqlAppClient.quit();
  }
};

exports.deleteTutor = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return false;

  const { tutor_id } = obj;

  const sqlAppClient = _getSQLAppClient();

  try {
    await sqlAppClient.query(`
      DELETE FROM virtual_tutor
      WHERE id = ${tutor_id};
    `);

    return true;
  } catch (e) {
    console.log("[err]", e);

    return false;
  } finally {
    sqlAppClient.quit();
  }
};
