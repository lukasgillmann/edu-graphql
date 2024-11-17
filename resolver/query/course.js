const { _getSQLAppClient, DEFAULT_OUTPUT, _jsonReplacer } = require("../common/utility");

const { listGradePolicy, _courseId2Wiki } = require("../common/course");
const { _getIsLicenseAvailable } = require("./license");

/**
 * Extract published branch `mongo id`s from the current platform with `wiki_slug`, `published_branch` pair
 * @returns [`wiki_slug`: String, `published_branch`: ObjectId]
 * @Example [`Digital-Learning-Solution.E-AngAff-A7.2021-2022`, `ObjectId("629855275f6e4b9fa61bd612")`]
 */
exports._listExtractedCoursePublishVersions = async (mongoAppClient) => {
  const versions = await mongoAppClient
    .db(process.env.MONGO_DB_MAIN_NAME)
    .collection("modulestore.active_versions")
    .aggregate([
      {
        $project: {
          wiki_slug: "$search_targets.wiki_slug",
          published_branch: "$versions.published-branch",
          // published_branch: "$versions.draft-branch"
        },
      },
    ])
    .toArray();

  return versions;
};

exports._listCoursePublishVersions = async (mongoAppClient) => {
  const versions = await mongoAppClient.db(process.env.MONGO_DB_MAIN_NAME).collection("modulestore.active_versions").find().toArray();
  return versions;
};

// diffs = [{ wiki_slug, published_branch }, ...]
exports._getCourseStructureAndDefs = async (mongoAppClient, diffs) => {
  // Based on the different versions, we extract Mongo branch and definitions
  let structures = await mongoAppClient
    .db(process.env.MONGO_DB_MAIN_NAME)
    .collection("modulestore.structures")
    .aggregate([
      {
        $match: {
          _id: { $in: diffs.map((v) => v.published_branch) },
        },
      },
    ])
    .toArray();

  const definitionIds = [];
  structures.forEach((v) => {
    if (!v || !v.blocks || !Array.isArray(v.blocks) || !v.blocks.length) return;
    v.blocks.forEach((vi) => definitionIds.push(vi.definition));
  });

  let defs = await mongoAppClient
    .db(process.env.MONGO_DB_MAIN_NAME)
    .collection("modulestore.definitions")
    .find({ _id: { $in: definitionIds } })
    .toArray();

  // now stringify data
  structures = JSON.stringify(structures, _jsonReplacer);
  defs = JSON.stringify(defs, _jsonReplacer);

  return { structures, defs };
};

const getRawHtml = (type, field, xId) => {
  if (!field) return "";

  switch (type) {
    case "google-document":
      return field.embed_code;
    case "scorm":
      return `<iframe src="${process.env.REACT_APP_BASE_URL}/media/scorm/${xId}/VAR_SCORM_HASH/${field.index_page_path}"} width="${field.width ? field.width : "100%"}" height="${field.height}"></iframe>`;
    case "lti":
      /* <div class="w-100 d-flex justify-content-center">
        <button id="v-lti-button" type="button" class="btn color-progress bg-main1 text-white border-0 p-btn fsp-16 fw-500 lh-22 hover-opacity trans-2 text-nowrap mt-2" style="height: fit-content;">${field.button_text}</button>
      </div> */
      return `
        <div class="mt-3" id="v-lti-container">
          <iframe src="${field.launch_url}"} width="100%" height="500px"></iframe>
        </div>
      `;
    case "lti_consumer":
      return `
        <div class="mt-3">
          <iframe src="${field.launch_url}"} width="100%" height="500px"></iframe>
        </div>
      `;
    default:
      return "";
  }
};

exports._getCourseStructure = async (sqlAppClient, mongoAppClient, courseId) => {
  let structure = {};

  let query = "";

  query = `
    SELECT section_title, sequence_title, vertical_title, duration 
    FROM unit_duration
    WHERE course_id='${courseId}'
  `;
  const durations = await sqlAppClient.query(query);

  query = `
    SELECT COUNT(DISTINCT(user_id)) AS count
    FROM student_courseenrollment_history
    WHERE course_id = "${courseId}"
  `;

  let enrolledCount = await sqlAppClient.query(query);
  if (enrolledCount.length) {
    enrolledCount = enrolledCount[0]["count"];
  } else {
    enrolledCount = 0;
  }

  // Get version from course_id
  let version = await mongoAppClient
    .db(process.env.MONGO_DB_MAIN_NAME)
    .collection("modulestore.active_versions")
    .find({
      "search_targets.wiki_slug": _courseId2Wiki(courseId),
    })
    .sort({ _id: -1 })
    .limit(1)
    .toArray();
  version = version.length > 0 ? version[0]["versions"]["published-branch"] : "";

  let payload = await mongoAppClient
    .db(process.env.MONGO_DB_MAIN_NAME)
    .collection("modulestore.structures")
    .aggregate([
      {
        $match: {
          _id: version,
        },
      },
      {
        $project: {
          display_name: { $arrayElemAt: ["$blocks.fields.display_name", 0] },
          "blocks.fields": 1,
          "blocks.definition": 1,
          "blocks.block_type": 1,
          "blocks.block_id": 1,
        },
      },
      {
        $group: {
          _id: "$display_name",
          blocks: { $last: "$blocks" },
        },
      },
    ])
    .toArray();

  // Add payload
  const courseTitle = payload.length > 0 ? payload[0]._id : "Undefined";
  payload = payload && payload.length ? payload[0].blocks : null;

  // payload will contain all the blocks of the target document
  if (payload && payload.length) {
    let secCounter = 0,
      seqCounter = 0,
      verCounter = 0;

    structure = {
      course_id: courseId,
      course_title: courseTitle,
      enrolled_count: enrolledCount,
      sections: [],
    };

    const courseBlockId = payload.findIndex((b) => b.block_id == "course");
    for (let [, chapterId] of payload[courseBlockId]["fields"]["children"]) {
      const chapterBlockId = payload.findIndex((b) => b["block_id"] == chapterId);
      const sectionTitle = payload[chapterBlockId]["fields"]["display_name"];
      structure["sections"].push({
        section_id: chapterId,
        section_title: sectionTitle,
        sequences: [],
      });

      seqCounter = 0;
      for (let [, sequentialId] of payload[chapterBlockId]["fields"]["children"]) {
        const sequentialBlockId = payload.findIndex((b) => b["block_id"] == sequentialId);
        const sequenceTitle = payload[sequentialBlockId]["fields"]["display_name"];
        structure["sections"][secCounter]["sequences"].push({
          sequence_id: sequentialId,
          sequence_title: sequenceTitle,
          verticals: [],
        });

        verCounter = 0;
        for (let [, verticalId] of payload[sequentialBlockId]["fields"]["children"]) {
          const verticalBlockId = payload.findIndex((b) => b["block_id"] == verticalId);
          const verticalTitle = payload[verticalBlockId]["fields"]["display_name"];
          const duration = durations.find((v) => v.section_title == sectionTitle && v.sequence_title == sequenceTitle && v.vertical_title == verticalTitle);
          structure["sections"][secCounter]["sequences"][seqCounter]["verticals"].push({
            vertical_id: verticalId,
            vertical_title: verticalTitle,
            duration: duration ? duration.duration : 0,
            xblock_ids: [],
          });

          for (let [type, xId] of payload[verticalBlockId]["fields"]["children"]) {
            const xblockId = payload.findIndex((b) => b["block_id"] == xId);
            structure["sections"][secCounter]["sequences"][seqCounter]["verticals"][verCounter]["xblock_ids"].push({
              id: xId,
              type: type,
              display_name: payload[xblockId]["fields"]["display_name"],
              vimeo_id: payload[xblockId]["fields"]["youtube_id_1_0"] || payload[xblockId]["fields"]["custom_vimeo_id"],
              definition_id: payload[xblockId]["definition"],
              raw_html: getRawHtml(type, payload[xblockId]["fields"], xId),
            });
          }
          verCounter++;
        }
        seqCounter++;
      }
      secCounter++;
    }
  }

  return structure;
};

exports.listCourse = async (_, obj, ctx) => {
  const { userId, permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN", "USER"].indexOf(permission) < 0) return null;

  const sqlAppClient = await _getSQLAppClient();
  const { page, page_size, search_term } = obj;

  try {
    const res = await this._listCourse(sqlAppClient, userId, page, page_size, search_term);
    return JSON.stringify(res, _jsonReplacer);
  } catch (e) {
    console.log("[sql err]", e);
    return null;
  } finally {
    sqlAppClient.quit();
  }
};

exports._listCourse = async (sqlAppClient, userId, page = 0, pageSize = DEFAULT_OUTPUT.page_size, search = []) => {
  let query = "";

  search.forEach(({ name, value }) => {
    query += `A.${name} LIKE '%${value}%' AND `;
  });
  query = query ? query.slice(0, -4) : "";

  query = `
    SELECT A.*, B.id AS course_index, C.is_active AS enrollment_status, 
      DATE_FORMAT(A.created, '%Y-%m-%dT%TZ') AS created,
      DATE_FORMAT(C.created, '%Y-%m-%dT%TZ') AS enrolled_date,
      E.name AS category, 
      DATE_FORMAT(A.start, '%Y-%m-%dT%TZ') AS run_start,
      DATE_FORMAT(A.end, '%Y-%m-%dT%TZ') AS run_end,
      DATE_FORMAT(C.start, '%Y-%m-%dT%TZ') AS enroll_start,
      DATE_FORMAT(C.end, '%Y-%m-%dT%TZ') AS enroll_end
    FROM course_overviews_courseoverview A
      LEFT JOIN learning_sequences_learningcontext B ON B.context_key = A.id
      LEFT JOIN student_courseenrollment C ON C.course_id = A.id AND C.user_id = ${userId}
      LEFT JOIN category_course D ON A.id = D.course_id
      LEFT JOIN category_overview E ON D.category_id = E.id
    ${query}
    ORDER BY id
    LIMIT ${Number(pageSize) * Number(page)}, ${Number(pageSize)};
    SELECT COUNT(*) AS total FROM course_overviews_courseoverview;
  `;

  let courses = await sqlAppClient.query(query);
  const total = courses[1][0].total;
  courses = courses[0];

  // Coach Info **************************************************************
  query = `
    SELECT first_name AS coach_first_name, email AS coach_email,  last_name AS coach_last_name, avatar AS coach_avatar, bio AS coach_bio, course_ids
    FROM course_coach
  `;
  let res = await sqlAppClient.query(query);

  let coaches = [];
  for (let v of res) {
    const courseIds = v.course_ids ? JSON.parse(v.course_ids) : null;
    if (!courseIds) {
      coaches.push(v);
      continue;
    }
    for (let courseId of courseIds) {
      coaches.push({ ...v, course_id: courseId });
    }
  }

  courses = courses.map((v) => ({ ...v, ...(coaches.find((vc) => vc.course_id == v.id) ? coaches.find((vc) => vc.course_id == v.id) : {}) }));

  for (;;) {
    // License evaluate **************************************************************
    const isLicenseAvailable = await _getIsLicenseAvailable(sqlAppClient, true);
    if (!isLicenseAvailable) {
      for (let i = 0; i < courses.length; i++) {
        courses[i].enrollment_status = 0;
      }
      break;
    }

    // Enrollment **************************************************************
    const enrolls = courses
      .filter((course) => course.enrollment_status == 1)
      .map((course) => {
        return { id: course.id };
      });
    if (!enrolls || !enrolls.length) break;

    query = `
      SELECT *
      FROM courseware_studentmodule
      WHERE course_id IN (${enrolls.map((e) => '"' + e.id + '"')}) AND student_id = ${userId} AND module_type='problem'
    `;
    const grades = await sqlAppClient.query(query);

    enrolls.forEach((enroll) => {
      const ind = courses.findIndex((c) => c.id == enroll.id);
      let currGrade = grades.filter((g) => g.course_id == enroll.id);
      if (currGrade && currGrade.length) {
        for (let i = 0; i < currGrade.length; i++) {
          let state = JSON.parse(currGrade[i]["state"]);
          let correct_map = state.correct_map;
          let input_state = state.input_state;
          let question_map = [];

          for (let key in input_state) {
            if (Object.prototype.hasOwnProperty.call(input_state, key)) {
              if (!state.student_answers || !state.student_answers[key]) {
                question_map.push({
                  id: key,
                  input_state: JSON.stringify(input_state[key]),
                });
                continue;
              }

              let isArray = Array.isArray(state.student_answers[key]);

              if (correct_map && correct_map[key]) {
                question_map.push({
                  id: key,
                  input_state: JSON.stringify(input_state[key]),
                  student_answer: isArray ? JSON.stringify(state.student_answers[key]) : state.student_answers[key],
                  isAnswerArray: isArray,
                  correctness: correct_map[key]["correctness"],
                  npoints: correct_map[key]["npoints"],
                  msg: correct_map[key]["msg"],
                  hint: correct_map[key]["hint"],
                  hintmode: correct_map[key]["hintmode"],
                  queuestate: correct_map[key]["queuestate"],
                  answervariable: correct_map[key]["answervariable"],
                });
              } else {
                question_map.push({
                  id: key,
                  input_state: JSON.stringify(input_state[key]),
                  student_answer: isArray ? JSON.stringify(state.student_answers[key]) : state.student_answers[key],
                  isAnswerArray: isArray,
                });
              }
            }
          }

          state = {
            question_map: question_map,
            seed: state.seed ? state.seed : null,
            raw_earned: state.score ? state.score.raw_earned : null,
            raw_possible: state.score ? state.score.raw_possible : null,
            attempts: state.attempts ? state.attempts : null,
            done: state.done ? state.done : null,
            lastTime: state.last_submission_time ? state.last_submission_time : null,
          };

          currGrade[i]["state"] = state;
        }
      }
      courses[ind]["grades"] = currGrade;
    });

    // Grading Policy ***********************************************************
    const { policies, moduleMapper } = await listGradePolicy(enrolls.map((e) => e.id));
    (policies || []).forEach((policy) => {
      const ind = courses.findIndex((c) => c.display_name == policy.title);

      let gradePolicy = policy.policy || { GRADER: [], GRADE_CUTOFFS: {} };

      courses[ind]["graders"] = gradePolicy.GRADER;
      courses[ind]["cutoff"] = parseFloat(gradePolicy.GRADE_CUTOFFS.Pass || 0.0);
      courses[ind]["numberOfSections"] = policy.numberOfSections;
      courses[ind]["moduleMapper"] = moduleMapper.find((m) => m["courseTitle"] == policy.title)["mapper"];

      // Add section title to each grade status block to group seperate grade blocks
      for (let i = 0; courses[ind]["grades"] && i < courses[ind]["grades"].length; i++) {
        let sectionTitle = null;
        for (let section of policy.childIds) {
          for (let cid of section.childBlockIds) {
            if (courses[ind]["grades"][i]["module_id"].includes(cid)) {
              sectionTitle = section.section_title;
              break;
            }
          }
          if (sectionTitle) break;
        }
        courses[ind]["grades"][i]["section_title"] = sectionTitle;
      }
    });

    break;
  }

  return {
    total: total,
    page: page,
    page_size: pageSize,
    data: courses,
  };
};

/**
 * [
 *  {
 *    course_id, display_name
 *  }
 * ]
 */
exports.getEnrolledCourses = async (userId) => {
  // Get enrolled courses

  const mysqlClient = _getSQLAppClient();

  let res = "",
    query = "";
  try {
    query = `
      SELECT S.course_id, V.display_name
      FROM student_courseenrollment S
        LEFT JOIN course_overviews_courseoverview V ON S.course_id = V.id
      WHERE S.is_active=1 AND S.user_id = ${userId}
    `;
    res = await mysqlClient.query(query);
    return res;
  } catch (e) {
    console.log("[get enrolled courses error]", e);
    return [];
  } finally {
    mysqlClient.quit();
  }
};

exports._getDownloads = async (mongoAppClient, courseId) => {
  let structure = {};
  const defs = [];

  // Get version from course_id
  let version = await mongoAppClient
    .db(process.env.MONGO_DB_MAIN_NAME)
    .collection("modulestore.active_versions")
    .find({
      "search_targets.wiki_slug": _courseId2Wiki(courseId),
    })
    .sort({ _id: -1 })
    .limit(1)
    .toArray();
  version = version.length > 0 ? version[0]["versions"]["published-branch"] : "";

  let payload = await mongoAppClient
    .db(process.env.MONGO_DB_MAIN_NAME)
    .collection("modulestore.structures")
    .aggregate([
      {
        $match: {
          _id: version,
        },
      },
      {
        $project: {
          display_name: { $arrayElemAt: ["$blocks.fields.display_name", 0] },
          "blocks.fields": 1,
          "blocks.definition": 1,
          "blocks.block_type": 1,
          "blocks.block_id": 1,
          // blocks: {
          //   "fields": 1,
          //   "definition": 1,
          //   "block_type": 1,
          //   "block_id": 1,
          // }
        },
      },
      {
        $group: {
          _id: "$display_name",
          blocks: { $last: "$blocks" },
        },
      },
    ])
    .toArray();

  // Add payload
  const courseTitle = payload.length > 0 ? payload[0]._id : "Undefined";
  payload = payload && payload.length ? payload[0].blocks : null;

  // payload will contain all the blocks of the target document
  if (payload && payload.length) {
    let secCounter = 0;

    structure = {
      course_id: courseId,
      course_title: courseTitle,
      sections: [],
    };

    const courseBlockId = payload.findIndex((b) => b.block_id == "course");
    for (let [, chapterId] of payload[courseBlockId]["fields"]["children"]) {
      const chapterBlockId = payload.findIndex((b) => b["block_id"] == chapterId);

      structure["sections"].push({
        section_id: chapterId,
        section_title: payload[chapterBlockId]["fields"]["display_name"],
        downloads: [],
      });

      for (let [, sequentialId] of payload[chapterBlockId]["fields"]["children"]) {
        const sequentialBlockId = payload.findIndex((b) => b["block_id"] == sequentialId);
        for (let [, verticalId] of payload[sequentialBlockId]["fields"]["children"]) {
          const verticalBlockId = payload.findIndex((b) => b["block_id"] == verticalId);
          for (let [type, xId] of payload[verticalBlockId]["fields"]["children"]) {
            const xblockId = payload.findIndex((b) => b["block_id"] == xId);

            if (type == "html" && payload[xblockId]["fields"]["display_name"] == "Téléchargements") {
              structure["sections"][secCounter]["downloads"].push({
                def_id: payload[xblockId]["definition"],
              });
              defs.push(payload[xblockId]["definition"]);
            }
          }
        }
      }
      secCounter++;
    }
  }

  // Now extract all the mapping values from definition
  const definitions = await mongoAppClient
    .db(process.env.MONGO_DB_MAIN_NAME)
    .collection("modulestore.definitions")
    .find({ _id: { $in: defs } })
    .toArray();

  for (let def of definitions) {
    def.fields.data.replace(/(<a href="(.+)" target.*>(.+)<\/a>)/g, function () {
      const href = arguments[2];
      const displayName = arguments[3];

      for (let i = 0; i < structure["sections"].length; i++) {
        for (let j = 0; j < structure["sections"][i]["downloads"].length; j++) {
          if (structure["sections"][i]["downloads"][j].def_id.toString() == def._id.toString()) {
            structure["sections"][i]["downloads"][j] = {
              def_id: def._id,
              href: href,
              displayName: displayName,
            };
          }
        }
      }
    });
  }

  return structure;
};
