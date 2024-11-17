const { _getSQLAppClient } = require("../common/utility");

exports._coachList = async (sqlAppClient, page, pageSize) => {
  let query = `
    SELECT id, first_name, last_name, email, phone_number, country, state, city, gender, bio, year_of_birth, avatar, course_ids
    FROM course_coach
    LIMIT ${page * pageSize}, ${pageSize};
    SELECT COUNT(*) AS total FROM course_coach;
  `;

  let res = await sqlAppClient.query(query);
  const total = res[1][0].total;
  res = res[0];

  let allCourseIds = [];
  for (let i = 0; i < res.length; i++) {
    res[i].course_ids = res[i].course_ids ? JSON.parse(res[i].course_ids) : [];
    res[i].courses = [];
    allCourseIds = [...allCourseIds, ...res[i].course_ids];
  }
  allCourseIds = [...new Set(allCourseIds)];

  if (allCourseIds.length) {
    const courses = await sqlAppClient.query(`
      SELECT id, display_name
      FROM course_overviews_courseoverview
      WHERE id IN (${allCourseIds.map((v) => '"' + v + '"')});
    `);

    for (let i = 0; i < res.length; i++) {
      if (!res[i].course_ids.length) continue;
      const itemCourses = courses.filter((v) => res[i].course_ids.includes(v.id));
      res[i].courses = itemCourses;
    }
  }

  return { total, page, page_size: pageSize, data: res };
};

exports.coachList = async (_, obj, ctx) => {
  const { permission } = ctx;

  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return null;

  const { page, page_size } = obj;
  const sqlAppClient = _getSQLAppClient();

  try {
    return await this._coachList(sqlAppClient, page, page_size);
  } catch (e) {
    console.log("[error]", e);
    return null;
  } finally {
    sqlAppClient.quit();
  }
};
