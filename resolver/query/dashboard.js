const { _toSQLTime } = require("../common/time");
const { SYSTEM_USERS } = require("../common/utility");
const { _getModuleTimeAvg, _getAvgLoginCount } = require("./analysis");
const { _getAvailableLicenseNumber } = require("./license");

exports._dashboardGet = async (sqlAppClient, mongoHistClient) => {
  const result = {
    course_enrollment: [],
    course_complete: [],
    best_courses: [],
    numbers: {},
    license: {},
  };
  let query = "",
    res = "";

  const currDate = new Date();
  const currSQLDate = _toSQLTime(new Date());

  // Course enrollment status per month
  query = `
    SELECT count(*) AS counter, MONTH(created) AS month
    FROM student_courseenrollment 
    WHERE YEAR(created)=${currDate.getFullYear()} OR (YEAR(created) = ${currDate.getFullYear() - 1} AND MONTH(created) > ${currDate.getMonth() + 1})
    GROUP BY MONTH(created)
  `;
  res = await sqlAppClient.query(query);
  const currMonth = currDate.getMonth();
  res = [...Array(12)].map((_, idx) => {
    const month = ((idx + currMonth + 1) % 12) + 1;
    const item = res.find((v) => v.month == month);
    return { month: month, counter: item ? item.counter : 0 };
  });
  result.course_enrollment = res;

  // Complete courses per month
  query = `
    SELECT count(*) AS counter, MONTH(end) AS month
    FROM course_overviews_courseoverview 
    WHERE
      end IS NOT NULL AND (
      (YEAR(end) = ${currDate.getFullYear() - 1} AND MONTH(end) > ${currDate.getMonth() + 1}) OR
      YEAR(end)=${currDate.getFullYear()})
    GROUP BY MONTH(end)
  `;
  res = await sqlAppClient.query(query);
  res = [...Array(12)].map((_, idx) => {
    const month = ((idx + currMonth + 1) % 12) + 1;
    const item = res.find((v) => v.month == month);
    return { month: month, counter: item ? item.counter : 0 };
  });
  result.course_complete = res;

  // Best enrolled courses
  query = `
    SELECT COUNT(*) AS counter, course_id
    FROM student_courseenrollment
    WHERE is_active=1
    GROUP BY course_id
    ORDER BY counter DESC
    LIMIT 3
  `;
  res = await sqlAppClient.query(query);
  result.best_courses = res;

  // Statistic Data
  query = `
    SELECT (Count(*) + 0) AS total_course 
      FROM course_overviews_courseoverview
    UNION ALL
    SELECT (Count(*) + 0) AS total_user 
      FROM auth_user
      WHERE email NOT IN (${SYSTEM_USERS.map((v) => `'${v}'`)}) AND is_superuser = 0 AND is_staff = 0
    UNION ALL
    SELECT (Count(*) + 0) AS total_course_active
        FROM course_overviews_courseoverview  
        WHERE start < '${currSQLDate}' AND (end > '${currSQLDate}' OR end IS NULL)
    UNION ALL
    SELECT (Count(*) + 0) AS total_user_active 
      FROM auth_user 
      WHERE is_active=1 AND email NOT IN (${SYSTEM_USERS.map((v) => `'${v}'`)}) AND is_superuser = 0 AND is_staff = 0
  `;
  res = await sqlAppClient.query(query);

  res = res.map((item) => item.total_course);
  let stat = {};
  if (res && res.length == 4) {
    stat = {
      total_course: res[0],
      total_user: res[1] - 1,
      total_course_active: res[2],
      total_user_active: res[3] - 1,
    };
  }
  result.numbers = stat;

  // Time spent
  const avgTimeSpents = await _getModuleTimeAvg(mongoHistClient);
  result.numbers.total_spent_avg = avgTimeSpents.total_spent_avg;
  result.numbers.quiz_spent_avg = avgTimeSpents.quiz_spent_avg;
  result.numbers.login_count_avg = await _getAvgLoginCount(mongoHistClient);

  // License data
  result.license = await _getAvailableLicenseNumber(sqlAppClient);

  return result;
};

exports.dashboardGet = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return null;
};
