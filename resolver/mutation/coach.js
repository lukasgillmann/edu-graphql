const { _getSQLAppClient } = require("../common/utility");

exports.editCoach = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return 0;

  const sqlAppClient = _getSQLAppClient();

  try {
    const { id, first_name, last_name, email, phone_number, country, state, city, gender, bio, year_of_birth, avatar, course_ids } = obj.input;

    let res = "",
      query = "";

    if (id != null && id != undefined) {
      query = `SELECT * FROM course_coach WHERE id=${id};`;
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
      query += bio != undefined ? ` ,bio = '${bio.replace(/'/g, "\\'")}'` : "";
      query += year_of_birth != undefined ? ` ,year_of_birth = ${year_of_birth}` : "";
      query += avatar != undefined ? ` ,avatar = '${avatar}'` : "";
      query += course_ids != undefined ? ` ,course_ids = '${JSON.stringify(course_ids)}'` : "";
      query = query.substring(2);
      query = `UPDATE course_coach SET ${query} WHERE id=${id}`;
    } else {
      query = `INSERT INTO course_coach 
        (first_name, last_name, email, phone_number, country, state, city, gender, bio, year_of_birth, avatar, course_ids)
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
            '${bio ? bio.replace(/'/g, "\\'") : ""}', 
            ${year_of_birth ? year_of_birth : 1900}, 
            '${avatar ? avatar : ""}',
            '${course_ids ? JSON.stringify(course_ids) : ""}'
          )
      `;
    }

    if (query) {
      res = await sqlAppClient.query(query);
    }

    return res.insertId;
  } catch (e) {
    console.log("[Edit coach Err]", e);

    return 0;
  } finally {
    sqlAppClient.quit();
  }
};

exports.deleteCoach = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return false;

  const { coach_id } = obj;

  const sqlAppClient = _getSQLAppClient();

  try {
    await sqlAppClient.query(`
      DELETE FROM course_coach
      WHERE id = ${coach_id};
    `);

    return true;
  } catch (e) {
    console.log("[err]", e);

    return false;
  } finally {
    sqlAppClient.quit();
  }
};
