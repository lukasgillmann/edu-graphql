const { _getSQLAppClient } = require("../common/utility");

exports.editCategory = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return 0;

  const { category_id, name, course_ids } = obj;

  const mysqlClient = _getSQLAppClient();

  let insertId = null,
    query = "";
  try {
    if (category_id) {
      // Edit mode
      const adminEditable = ["SUPERADMIN", "STAFF"].indexOf(permission) >= 0 ? true : false;
      query = `UPDATE category_overview SET name = '${name}' WHERE id=${category_id} AND admin_editable=${adminEditable}`;
      await mysqlClient.query(query);
      insertId = category_id;
    } else {
      // Create mode
      query = `INSERT INTO category_overview (name) VALUES ('${name}');`;
      let res = await mysqlClient.query(query);
      insertId = res.insertId;

      query = "";
      for (let course_id of course_ids) {
        query += `('${course_id}', ${insertId}), `;
      }

      if (query) {
        query = query.slice(0, -2);
        query = `INSERT INTO category_course (course_id, category_id) VALUES ${query};`;
        res = await mysqlClient.query(query);
      }
    }

    return insertId;
  } catch (e) {
    console.log("[category Err]", e);
    return null;
  } finally {
    mysqlClient.quit();
  }
};

exports.assignCoursesToCategory = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return false;

  const { category_id, course_ids } = obj;

  const mysqlClient = _getSQLAppClient();
  let query = "",
    res = "";

  try {
    query = permission === "ADMIN" ? " AND admin_editable=1" : "";
    query = `SELECT * FROM category_overview WHERE id=${category_id} ${query}`;
    res = await mysqlClient.query(query);

    if (res && res.length) {
      query = `
        SELECT * 
        FROM category_course
        WHERE category_id=${category_id} AND course_id IN (${course_ids.map((id) => '"' + id + '"')})
      `;
      res = await mysqlClient.query(query);

      let todoCourseIds = [];
      for (let course_id of course_ids) {
        if (res.findIndex((r) => r.course_id == course_id) < 0) {
          todoCourseIds.push(course_id);
        }
      }

      query = "";
      for (let course_id of todoCourseIds) {
        query += `('${course_id}', ${category_id}), `;
      }
      if (query) {
        query = query.slice(0, -2);
        query = `INSERT INTO category_course (course_id, category_id) VALUES ${query}`;

        await mysqlClient.query(query);
      } else {
        throw Error("No updated detected");
      }
    } else {
      throw Error("No matching data found!");
    }

    return true;
  } catch (e) {
    console.log("[category course assign Err]", e);

    return false;
  } finally {
    mysqlClient.quit();
  }
};

exports.dismissCoursesFromGroup = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return false;

  const { category_id, course_ids } = obj;

  const mysqlClient = _getSQLAppClient();

  try {
    await mysqlClient.query(`DELETE FROM category_course WHERE course_id IN (${course_ids.map((id) => '"' + id + '"')}) AND category_id=${category_id}`);

    return true;
  } catch (e) {
    console.log("[user Err]", e);

    return false;
  } finally {
    mysqlClient.quit();
  }
};

exports.deleteCategory = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return false;

  const { category_id } = obj;

  const mysqlClient = _getSQLAppClient();

  try {
    let query = `SELECT * FROM category_overview WHERE id=${category_id}`;

    if (permission == "ADMIN") {
      query += " AND admin_editable = 1";
    }

    let res = await mysqlClient.query(query);

    if (res && res.length) {
      query = `
        DELETE FROM category_overview WHERE id=${category_id};
        DELETE FROM category_course WHERE category_id=${category_id};
      `;
      await mysqlClient.query(query);
    }

    return true;
  } catch (e) {
    console.log("[category Err]", e);

    return false;
  } finally {
    await mysqlClient.quit();
  }
};
