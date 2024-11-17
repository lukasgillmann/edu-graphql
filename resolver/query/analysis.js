const { listGradePolicy } = require("../common/course");
const { _getSQLAppClient, _getMongoLogClient, _getMongoForumClient, DEFAULT_OUTPUT } = require("../common/utility");
const { _listMeetingInspect } = require("./meet_inspect");
const { _listLoginHist } = require("./login_hist");

exports.loginHistoryList = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return [];

  const { user_id, page, page_size } = obj;

  const mongoClient = await _getMongoLogClient();
  try {
    return await _listLoginHist(mongoClient, user_id, page, page_size);
  } catch (e) {
    console.log("[login inspect list error]", e);
    return [];
  } finally {
    mongoClient.close();
  }
};

function getCutoff(policy) {
  if (policy && Object.prototype.hasOwnProperty.call(policy, "policy")) {
    if (policy.policy && Object.prototype.hasOwnProperty.call(policy.policy, "GRADE_CUTOFFS")) {
      if (policy.policy.GRADE_CUTOFFS && Object.prototype.hasOwnProperty.call(policy.policy.GRADE_CUTOFFS, "Pass")) {
        return policy.policy.GRADE_CUTOFFS.Pass;
      }
    }
  }
  return 0;
}

async function _getCourseTimespent(mongoHistClient, userId, courseIds = []) {
  let hists = await mongoHistClient
    .db(process.env.MONGO_DB_INSPECT_NAME)
    .collection("inspect.module")
    .aggregate([
      {
        $match: {
          user_id: Number(userId),
          ...(courseIds.length ? { course_id: { $in: courseIds } } : {}),
        },
      },
      {
        $project: {
          course_id: 1,
          total_spent: 1,
          quiz_spent: 1,
        },
      },
    ])
    .toArray();
  return hists;
}

/**
 * {
 *  date
 *  course_id
 *  total_spent
 *  quiz_spent
 *  details {
 *    module_title, total_spent, quiz_spent, correct_count
 *  }
 * }
 */
async function _getModuleTimeList(mongoHistClient, userId, courseIds = [], page = 0, pageSize = DEFAULT_OUTPUT.page_size) {
  const filterBody = [
    {
      $match: {
        user_id: Number(userId),
        ...(courseIds.length ? { course_id: { $in: courseIds } } : {}),
      },
    },
    { $unwind: "$data" },
    {
      $project: {
        course_id: 1,
        total_spent: 1,
        quiz_spent: 1,
        date: "$data.date",
        details: "$data.details",
      },
    },
    { $unwind: "$details" },
  ];

  const proData = mongoHistClient
    .db(process.env.MONGO_DB_INSPECT_NAME)
    .collection("inspect.module")
    .aggregate([...filterBody, { $sort: { date: -1 } }, { $skip: pageSize * page }, { $limit: pageSize }])
    .toArray();

  const proTotal = mongoHistClient
    .db(process.env.MONGO_DB_INSPECT_NAME)
    .collection("inspect.module")
    .aggregate([...filterBody, { $group: { _id: null, count: { $sum: 1 } } }])
    .toArray();

  let [dbData, totalCount] = await Promise.all([proData, proTotal]);
  totalCount = totalCount.length ? totalCount[0].count : 0;

  let hists = {
    total: totalCount,
    page: page,
    page_size: pageSize,
    data: dbData,
  };

  return hists;
}

/**
 * [{
 *    courseId
 *    courseTitle
 *    cutoff
 *    grade
 *    total_spent
 *    quiz_spent
 *    sections: [
 *      sectionTitle
 *      weight
 *      gradeFormat
 *      raw_possible
 *      raw_earned
 *      total_spent
 *      quiz_spent
 *    ]
 * }]
 */

exports._courseGradeList = async (sqlAppClient, mongoHistClient, studentId, page = 0, pageSize = DEFAULT_OUTPUT.page_size) => {
  let query = "",
    res = "",
    courseIds = [];

  // Get unique courses as [{ courseId, courseTitle, sections: [{sectionTitle, weight, gradeFormat, raw_possible, raw_earned}, ...], cutoff, grade }, ...] type
  let uniqCourses = [];

  query = `
    SELECT A.course_id, A.progress, B.module_id, B.state, C.display_name, C.course_image_url, DATE_FORMAT(C.created, '%Y-%m-%dT%TZ') AS created, DATE_FORMAT(A.start, '%Y-%m-%dT%TZ') AS enroll_start
    FROM (
      SELECT * 
      FROM student_courseenrollment
      WHERE is_active=${true} AND user_id = ${studentId}
      GROUP BY course_id
      LIMIT ${page * pageSize}, ${pageSize} 
    ) A
      LEFT JOIN courseware_studentmodule B ON A.course_id = B.course_id AND A.user_id = B.student_id AND B.module_type = 'problem'
      LEFT JOIN course_overviews_courseoverview C ON A.course_id = C.id;

    SELECT COUNT(DISTINCT(course_id)) AS total FROM student_courseenrollment WHERE is_active=${true} AND user_id = ${studentId};

    SELECT DISTINCT(course_id) FROM student_courseenrollment WHERE is_active=${true} AND user_id = ${studentId};
  `;
  res = await sqlAppClient.query(query);

  const total = res[1][0].total;
  const totalCourseIds = res[2].map((v) => v.course_id) || [];
  res = res[0];

  if (res && res.length) {
    courseIds = res.map((r) => r.course_id);
    courseIds = [...new Set(courseIds)];

    courseIds.forEach((courseId) => {
      const oneItem = res.find((r) => r.course_id == courseId);
      uniqCourses.push({
        course_id: courseId,
        course_title: oneItem ? oneItem.display_name : "",
        course_image_url: oneItem ? oneItem.course_image_url : "",
        created: oneItem ? oneItem.created : "",
        enroll_start: oneItem ? oneItem.enroll_start : "",
        progress: oneItem ? oneItem.progress : 0,
      });
    });

    let problemBlocks = [];
    for (let row of res) {
      const state = JSON.parse(row.state);
      let { raw_earned, raw_possible } = state && state.score ? state.score : {};
      if (raw_earned == null) raw_earned = 0;
      if (raw_possible == null) raw_possible = 0;

      problemBlocks.push({
        course_id: row.course_id,
        module_id: row.module_id,
        course_title: row.display_name,
        raw_possible: Number(raw_possible),
        raw_earned: Number(raw_earned),
      });
    }

    res = null;
    if (problemBlocks.length) {
      const { policies, moduleMapper } = await listGradePolicy(courseIds);

      for (let i = 0; i < uniqCourses.length; i++) {
        const { course_id, course_title } = uniqCourses[i];
        const sectionGradeFormatMapper = (moduleMapper.find((m) => m.courseTitle == course_title) || {}).mapper;
        if (!sectionGradeFormatMapper) continue;

        uniqCourses[i]["sections"] = sectionGradeFormatMapper; // [{ sectionTitle: "...", gradeFormat: "Quiz" }, ...]

        // now add grade
        const currPolicy = policies.find((p) => p.title == course_title);
        if (!currPolicy) continue;

        uniqCourses[i]["cutoff"] = getCutoff(currPolicy);

        let grade = 0.0;

        for (let j = 0; j < sectionGradeFormatMapper.length; j++) {
          const { sectionTitle, gradeFormat } = sectionGradeFormatMapper[j];
          const sameFormatModuleCount = sectionGradeFormatMapper.filter((g) => g.gradeFormat == gradeFormat).length;
          let weightObj = currPolicy.policy && currPolicy.policy.GRADER ? currPolicy.policy.GRADER.find((g) => g.type == gradeFormat) : null;
          const weight = weightObj && Object.prototype.hasOwnProperty.call(weightObj, "weight") ? weightObj.weight : 0.0;

          const { childBlockIds } = currPolicy.childIds.find((c) => c.section_title == sectionTitle);

          const secProblemBlocks = problemBlocks.filter((p) => p.module_id && p.course_id == course_id && childBlockIds.findIndex((cid) => cid == p.module_id.split("@")[2]) >= 0);

          let rawEarned = 0,
            rawPossible = 0;
          secProblemBlocks.forEach((xb) => {
            rawEarned += xb.raw_earned;
            rawPossible += xb.raw_possible;
          });

          uniqCourses[i]["sections"][j]["weight"] = weight / sameFormatModuleCount;
          uniqCourses[i]["sections"][j]["raw_earned"] = rawEarned;
          uniqCourses[i]["sections"][j]["raw_possible"] = rawPossible;

          grade += rawPossible != 0 ? ((weight / sameFormatModuleCount) * rawEarned) / rawPossible : 0.0;
        }

        uniqCourses[i]["grade"] = grade;
      }

      /** Policies
       * [{
            id: g._id,
            title: courseTitle,  // Course title
            policy: {
              "GRADER": [
                  {
                      "min_count": NumberInt("3"),
                      "weight": 0.75,
                      "type": "Homework",
                      "drop_count": NumberInt("1"),
                      "short_label": "Ex"
                  },
                  {
                      "short_label": "",
                      "min_count": NumberInt("1"),
                      "type": "Exam",
                      "drop_count": NumberInt("0"),
                      "weight": 0.25
                  }
              ],
              "GRADE_CUTOFFS": {
                  "Pass": 0.6
              }
          },
          childIds: [{ section_title: "...", childBlockIds: ["...", "..."]}]
          numberOfSections: numberOfSections
        }, ...]
       */

      /** Module Mapper
       * {
       *    courseTitle: "...",
       *    mapper: [{ sectionTitle: "...", gradeFormat: "Quiz"}, ...]
       * }
       */

      // policies.forEach(policy => {
      //   const ind = problemBlocks.findIndex(c => c.course_title == policy.title);
      //   problemBlocks[ind]['gradePolicy'] = policy.policy;
      //   problemBlocks[ind]['moduleMapper'] = moduleMapper.find(m => m['courseTitle'] == policy.title)['mapper'];
      // });
    }
  }

  // Add time spent for each module and section
  const courseLogs = await _getCourseTimespent(
    mongoHistClient,
    studentId,
    uniqCourses.map((v) => v.course_id)
  );

  for (let i = 0; i < uniqCourses.length; i++) {
    const { course_id } = uniqCourses[i];
    const logItem = courseLogs.find((v) => v.course_id === course_id) || {};
    uniqCourses[i]["total_spent"] = Math.round(logItem.total_spent) || 0;
    uniqCourses[i]["quiz_spent"] = Math.round(logItem.quiz_spent) || 0;
  }

  return { total, page, page_size: pageSize, data: uniqCourses, course_ids: totalCourseIds };
};

exports.courseGradeList = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return [];

  const { user_id, page, page_size } = obj;
  const sqlAppClient = _getSQLAppClient();
  const mongoHistClient = await _getMongoLogClient();

  try {
    return await this._courseGradeList(sqlAppClient, mongoHistClient, user_id, page, page_size);
  } catch (e) {
    console.log("[error]", e);
    return [];
  } finally {
    sqlAppClient.quit();
    mongoHistClient.close();
  }
};

exports.vimeoList = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return [];

  const mongoClient = await _getMongoLogClient();

  try {
    let hists = await mongoClient
      .db(process.env.MONGO_DB_INSPECT_NAME)
      .collection("inspect.vimeo")
      .aggregate([{ $unwind: "$data" }])
      .toArray();

    hists = hists.map((h) => h.data);

    const uniqHists = [];
    for (let i = 0; i < hists.length; i++) {
      const idx = uniqHists.findIndex((u) => u.vimeo_id == hists[i].vimeo_id);
      if (idx >= 0) {
        uniqHists[idx].seek = parseFloat(uniqHists[idx].seek) + parseFloat(hists[i].seek);
        uniqHists[idx].duration = parseFloat(uniqHists[idx].duration) + parseFloat(hists[i].duration);
        uniqHists[idx].spent = parseFloat(uniqHists[idx].spent) + parseFloat(hists[i].spent);
      } else {
        uniqHists.push(hists[i]);
      }
    }

    return hists;
  } catch (e) {
    console.log("[mongoerror]", e);
    return [];
  } finally {
    mongoClient.close();
  }
};

exports._moduleTimeList = async (sqlAppClient, mongoHistClient, studentId, page, pageSize) => {
  studentId = Number(studentId);
  const moduleLogs = await _getModuleTimeList(mongoHistClient, studentId, [], page, pageSize);
  const courseIds = moduleLogs.data.map((m) => m.course_id);

  if (courseIds.length == 0) return DEFAULT_OUTPUT;

  const res = await sqlAppClient.query(`
    SELECT id, display_name
    FROM course_overviews_courseoverview
    WHERE id IN (${courseIds.map((id) => '"' + id + '"')})
  `);

  for (let i = 0; i < moduleLogs.data.length; i++) {
    const courseTitle = res.find((r) => r.id == moduleLogs.data[i].course_id).display_name;
    moduleLogs.data[i]["course_title"] = courseTitle;
  }

  return moduleLogs;
};

exports.meetingTimeList = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return null;

  const { user_id, page, page_size } = obj;
  const mongoHistClient = await _getMongoLogClient();

  try {
    return await _listMeetingInspect(mongoHistClient, user_id, null, page, page_size);
  } catch (e) {
    console.log("[err]", e);
    return null;
  } finally {
    mongoHistClient.close();
  }
};

exports.moduleTimeList = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return null;

  const { user_id, page, page_size } = obj;
  const sqlAppClient = _getSQLAppClient();
  const mongoHistClient = await _getMongoLogClient();

  try {
    return await this._moduleTimeList(sqlAppClient, mongoHistClient, user_id, page, page_size);
  } catch (e) {
    console.log("[err]", e);
    return null;
  } finally {
    sqlAppClient.quit();
    mongoHistClient.close();
  }
};

exports.getStudentAnalysis = async (userId, courseId) => {
  const sqlAppClient = _getSQLAppClient();
  const forumClient = await _getMongoForumClient();

  let query = "",
    res = "";

  try {
    // Certificate
    query = `
      SELECT id, course_id, course_title, module_title, is_final, total, created
      FROM student_certificate
      WHERE user_id = ${userId} AND course_id='${courseId}'
    `;
    res = await sqlAppClient.query(query);
    const certNumber = res.filter((v) => !v.is_final).length;

    // Viewed
    query = `SELECT vertical_ids FROM student_verticals_viewed WHERE user_id=${userId}`;
    res = await sqlAppClient.query(query);
    let sum = 0;
    for (let { vertical_ids } in res) {
      sum += vertical_ids ? JSON.parse(vertical_ids).length : 0;
    }
    const resourceSeen = sum;

    const policies = await listGradePolicy([courseId]);
    sum = 0;
    for (let section of policies.moduleMapper) {
      sum += section.mapper.filter((v) => v.gradeFormat == "Quiz").length;
    }
    const remainModules = sum - certNumber;

    // Comments posted
    const commentCounter = await forumClient
      .db(process.env.MONGO_DB_FORUM_NAME)
      .collection("contents")
      .count({ author_id: Number(userId), course_id: courseId });

    return { certificateNumber: certNumber, resourceSeen: resourceSeen, remainModules: remainModules, commentCounter: commentCounter };
  } catch (e) {
    console.log("[student analysis error]", e);
    return { certificateNumber: 0, resourceSeen: 0, remainModules: 0, commentCounter: 0 };
  } finally {
    sqlAppClient.quit();
    forumClient.close();
  }
};

exports._getModuleTimeAvg = async (mongoClient) => {
  let hists = await mongoClient
    .db(process.env.MONGO_DB_INSPECT_NAME)
    .collection("inspect.module")
    .aggregate([
      {
        $group: {
          _id: null,
          total_spent_avg: { $avg: "$total_spent" },
          quiz_spent_avg: { $avg: "$quiz_spent" },
        },
      },
    ])
    .toArray();

  if (!hists.length) return { total_spent_avg: 0, quiz_spent_avg: 0 };
  hists = hists[0];

  return {
    total_spent_avg: Math.round(hists.total_spent_avg * 100) / 100,
    quiz_spent_avg: Math.round(hists.quiz_spent_avg * 100) / 100,
  };
};

exports._getAvgLoginCount = async (mongoHistClient) => {
  let hists = await mongoHistClient
    .db(process.env.MONGO_DB_INSPECT_NAME)
    .collection("inspect.login_hist")
    .aggregate([
      {
        $project: {
          user_id: 1,
          count: { $size: "$data" },
        },
      },
      {
        $group: {
          _id: null,
          login_count_avg: { $avg: "$count" },
        },
      },
    ])
    .toArray();

  const avgCount = hists.length ? Math.round(hists[0].login_count_avg * 100) / 100 : 0;
  return avgCount;
};
