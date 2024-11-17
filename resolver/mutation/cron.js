// const cron = require('node-cron');
const { _getSQLAppClient, _fillHTMLTemplate, _getMongoAppClient, _uploadToVimeo, _getVimeoTranscodeStatus, _dowloadVideo } = require("../common/utility");
const { getStudentAnalysis } = require("../query/analysis");
const { sendEmail } = require("../query/email");
const { _updateLicenseStatus } = require("./license");
const axios = require("axios");
const { _getCourseStructure, getEnrolledCourses, _listExtractedCoursePublishVersions } = require("../query/course");
const { ObjectId } = require("mongodb");
const { listGradePolicy } = require("../common/course");
const { _toSQLTime } = require("../common/time");

const validateEmail = (email) => {
  return String(email)
    .toLowerCase()
    .match(/^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/);
};

exports.sendWeeklyMails = async () => {
  const sqlAppClient = _getSQLAppClient();
  const mongoAppClient = await _getMongoAppClient();

  console.log("[*********** CRON SEND WEEKLY EMAIL ***********************]");

  let query = "",
    res = "",
    placeHolder = "";

  try {
    // Now send email to the user/admin // ****************************************************************
    const emailType = "course_progress";
    query = `SELECT admin_email, subject, content, end_user FROM email_template WHERE type='${emailType}' AND enabled=1`;
    res = await sqlAppClient.query(query);

    const userHtml = res && res.length ? res.find((v) => v.end_user == "user").content : null;
    let adminEmail = res && res.length ? res.find((v) => v.end_user == "user").admin_email : null;
    adminEmail = adminEmail ? adminEmail : process.env.REACT_APP_CONTACT_EMAIL;
    const adminHtml = res && res.length ? res.find((v) => v.end_user == "admin").content : null;
    const userSubject = res && res.length ? res.find((v) => v.end_user == "user").subject : "";
    const adminSubject = res && res.length ? res.find((v) => v.end_user == "admin").subject : "";

    if (!userHtml && !adminHtml) throw "template not exist";

    query = `
      SELECT A.id, A.first_name, A.last_name, A.username, A.email
      FROM auth_user A
        LEFT JOIN auth_userprofile B ON A.id = B.user_id
      WHERE A.is_active=${true} AND A.is_superuser=${false} AND A.is_staff=${false} AND B.email_reminder=1;
    `;
    res = await sqlAppClient.query(query);

    for (let user of res) {
      if (!validateEmail(user.email)) continue;

      const courses = await getEnrolledCourses(user.id);

      if (courses.length) {
        for (let { course_id, display_name } of courses) {
          const { certificateNumber, resourceSeen, remainModules, commentCounter } = await getStudentAnalysis(user.id, course_id);
          const structure = await _getCourseStructure(sqlAppClient, mongoAppClient, course_id);
          const finalEvalIndex = structure.sections && Array.isArray(structure.sections) ? structure.sections.findIndex((v) => v.section_title == "ÉVALUATION FINALE") : 0;

          const values = {
            PLATFORM_NAME: process.env.REACT_APP_SITE_DISPLAY_NAME,
            LOGIN_LINK: process.env.REACT_APP_AUTH_ENDPOINT,
            SURNAME: user.first_name || user.username,
            NAME: user.last_name,
            USER_ID: user.email,
            ADMIN_EMAIL: adminEmail,
            CURRENT_DATE: new Date().toISOString(),

            COURSE_TITLE: display_name,
            FINAL_EVAL_LINK: finalEvalIndex >= 0 ? `${process.env.REACT_APP_APP_ENDPOINT}/board/${course_id}/${finalEvalIndex}/0/0` : `(Empty)`,
            SETTING_LINK: `${process.env.REACT_APP_APP_ENDPOINT}/dashbaord/settings`,

            COMMENTS: commentCounter,
            BADGES_WON: certificateNumber,
            EDUCATIONAL_RESOURCES_SEEN: resourceSeen,
            BADGES_REMAIN: remainModules,
          };
          await sendEmail(emailType, user.email, _fillHTMLTemplate(userSubject, values), _fillHTMLTemplate(userHtml, values), display_name);
        }
      }
    }

    // Send admin email
    const currSQLDate = _toSQLTime(new Date());
    query = `
      SELECT COUNT(*) AS total_course FROM course_overviews_courseoverview
      UNION
      SELECT COUNT(*) AS total_user FROM auth_user
      UNION
      SELECT COUNT(*) AS total_course_active
          FROM course_overviews_courseoverview  
          WHERE start < '${currSQLDate}' AND (end > '${currSQLDate}' OR end IS NULL)
      UNION
      SELECT COUNT(*) AS total_user_active FROM auth_user WHERE is_active=1
      UNION
      SELECT COUNT(*) AS completed_courses
          FROM course_overviews_courseoverview  
          WHERE end < '${currSQLDate}'
    `;
    res = await sqlAppClient.query(query);
    res = res.map((item) => item.total_course);

    placeHolder = "TESTING";
    if (res && res.length == 5) {
      placeHolder += `<p>Total Courses: ${res[0]}</p>`;
      placeHolder += `<p>Total Users: ${res[1]}</p>`;
      placeHolder += `<p>Total Courses Active: ${res[2]}</p>`;
      placeHolder += `<p>Total Users Active: ${res[3]}</p>`;
      placeHolder += `<p>Completed Courses: ${res[4]}</p>`;
    }

    const values = {
      PLATFORM_NAME: process.env.REACT_APP_SITE_DISPLAY_NAME,
      LOGIN_LINK: process.env.REACT_APP_AUTH_ENDPOINT,
      ADMIN_EMAIL: adminEmail,
      CURRENT_DATE: new Date().toISOString(),
    };

    if (adminHtml) await sendEmail(emailType, process.env.REACT_APP_CONTACT_EMAIL, _fillHTMLTemplate(adminSubject, values), _fillHTMLTemplate(adminHtml, values, placeHolder));
  } catch (e) {
    console.log("[err]", e);
  } finally {
    sqlAppClient.quit();
    mongoAppClient.close();
  }
};

exports.updateMeetResults = async () => {
  console.log("[***** CRON MEET UPDATE *****]");

  const sqlAppClient = _getSQLAppClient();
  let res = "",
    query = "";

  try {
    // STEP 1. Check the transcode status of all the uploaded files
    res = await sqlAppClient.query(`
      SELECT file_id FROM meet_recording WHERE status='in_progress';
      UPDATE meet_recording SET status='error' WHERE created < NOW() - INTERVAL 1 DAY;
    `);
    res = res[0].map((v) => v.file_id);

    const completedVimeoIds = [],
      errorVimeoIds = [];
    const promStatusCodes = res.map((v) => _getVimeoTranscodeStatus(v));
    const promRes = await Promise.all(promStatusCodes);
    console.log("[status code of vimeo]", res, promRes);

    for (let i = 0; i < res.length; i++) {
      if (promRes[i] == "complete") completedVimeoIds.push(res[i]);
      if (promRes[i] == "error") errorVimeoIds.push(res[i]);
    }

    // STEP 2: Extract the upload links
    query = `SELECT recording_url, room FROM meet_event WHERE end_time < NOW() - INTERVAL 10 MINUTE AND end_time > NOW() - INTERVAL 70 MINUTE;`;
    const recordings = await sqlAppClient.query(query);

    // Fetch HTML data
    query = "";
    for (let recording of recordings) {
      let res = await axios.get(recording.recording_url);

      // Extract actual record file links
      let links = res.data.match(/let DOWNLOAD_RECORDING_URLS = "\[(.*)\]"/);
      if (links.length == 2) {
        links = links[1].split(", ");
        console.log("[LINKS]", links);
        if (!links || !links.length) continue;

        query += `INSERT INTO meet_recording (room, url, file_id, status) VALUES `;
        for (let link of links) {
          query += `(${sqlAppClient.escape(recording.room)}, ${sqlAppClient.escape(link)}, "", 'pristine'), `;
        }
        query = query.slice(0, -2) + ";";
      }
    }
    if (query) await sqlAppClient.query(query);

    query = `
      SELECT A.id, A.room, A.url 
      FROM meet_recording A
        LEFT JOIN meet_event B ON A.room = B.room
      WHERE A.status='pristine' AND B.end_time < NOW() - INTERVAL 10 MINUTE;
    `;
    if (completedVimeoIds.length) {
      query += `UPDATE meet_recording SET status='complete' WHERE file_id IN (${completedVimeoIds.map((v) => '"' + v + '"')});`;
    }
    if (errorVimeoIds.length) {
      query += `UPDATE meet_recording SET status='error' WHERE file_id IN (${errorVimeoIds.map((v) => '"' + v + '"')});`;
    }
    res = await sqlAppClient.query(query);

    // STEP 3: We upload
    const files = res.length > 1 ? res[0] : res;
    console.log("[files to be uploaded]", files);
    for (let file of files) {
      const localLink = await _dowloadVideo(file.url);
      const vimeoUri = (await _uploadToVimeo(localLink, file.room)).replace("/videos/", "");
      await sqlAppClient.query(`UPDATE meet_recording SET file_id=?, status='in_progress' WHERE id=?`, [vimeoUri, file.id]);
    }

    return true;
  } catch (e) {
    console.log("[err]", e);
    return false;
  } finally {
    sqlAppClient.quit();
  }
};

/**
 *
 * @param {*} currVersions wiki_slug : published_branch pair
 * @returns `[diff_versions, new_versions, structures, defs, count]`
 */
const getCourseDataFromDigital = async (currVersions) => {
  const API_DIGITAL = "https://api.plateformedoctonet.com/api";

  const TEST_JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJwZXJtaXNzaW9uIjoiVEVTVFVTRVIiLCJpZCI6bnVsbCwiZXhwaXJlZCI6bnVsbCwiaWF0IjoxNjM5NjM2NzY5fQ.tZBn4fiZLTeWNiqewj9yHYO3hE8WO5qg_fEHGQvdyP4";

  try {
    let apiData = await axios.post(
      API_DIGITAL,
      JSON.stringify({
        query: `
        mutation sync_course_differences($input: [CourseVersion]) {
          sync_course_differences(input: $input) {
            diff_versions
            new_versions
            structures
            defs
            counter
            sql_data
          }
        }
      `,
        variables: {
          input: currVersions,
        },
      }),
      { headers: { Authorization: TEST_JWT, "Content-Type": "application/json" } }
    );

    apiData = apiData.data.data.sync_course_differences;
    return apiData;
  } catch (e) {
    console.log("[api error]", e.request.data || e);
    return {};
  }
};

const OBJECT_ID_LIST = ["_id", "previous_version", "original_version", "definition", "update_version", "source_version", "draft-branch", "published-branch"];
const DATE_ID_LIST = ["edited_on", "start"];
function reviseMongoObj(obj) {
  for (let key of Object.keys(obj)) {
    if (obj[key] == null) continue;

    if (OBJECT_ID_LIST.includes(key)) {
      obj[key] = ObjectId(obj[key]);
      continue;
    } else if (DATE_ID_LIST.includes(key)) {
      obj[key] = new Date(obj[key]);
    }

    if (typeof obj[key] === "object") {
      obj[key] = reviseMongoObj(obj[key]);
    } else if (Array.isArray(obj[key])) {
      for (let i = 0; i < obj[key].length; i++) {
        obj[key][i] = reviseMongoObj(obj[key][i]);
      }
    }
  }
  return obj;
}

exports.syncCourseDifferencesFromDigital = async () => {
  console.log("[Function started]");

  const apiStartTime = new Date().getTime();

  const mongoAppClient = await _getMongoAppClient();
  const sqlAppClient = _getSQLAppClient();

  try {
    console.log("[updating license status]");
    // We update license status every day 'current', 'pending', 'disabled'
    await _updateLicenseStatus(sqlAppClient);

    console.log("[update license status finished]");
    // Now sync course differences
    // We don't do this action to the base template

    const blockList = ["medicaformation", "paraformation"];

    if (blockList.includes(process.env.REACT_APP_SITE_NAME)) return;

    console.log("[********************************* sync course difference started *********************************]");

    let counter = 0;
    let newDraftId = "";
    let isEdited = false;

    do {
      const currVersions = await _listExtractedCoursePublishVersions(mongoAppClient);
      const apiData = await getCourseDataFromDigital(currVersions);

      // If the time elapse Lambda billed time, we stop iteration
      if (new Date().getTime() - apiStartTime > 13 * 1000) {
        console.log("[*** Time Expired. We stop iteration !!! ***]");
        break;
      }

      if (!apiData || (!apiData.new_versions && !apiData.diff_versions)) break;

      counter = apiData.counter;
      if (counter == 0) break;

      isEdited = true;

      // Now insert those items
      apiData.structures = JSON.parse(apiData.structures) || [];
      apiData.defs = JSON.parse(apiData.defs) || [];
      apiData.new_versions = JSON.parse(apiData.new_versions) || [];
      apiData.diff_versions = JSON.parse(apiData.diff_versions) || [];
      apiData.sql_data = apiData.sql_data ? JSON.parse(apiData.sql_data) : null;

      console.log(`[Coming Data]: (Counter): ${apiData.counter}`, apiData.new_versions.length ? "(New Version)" : apiData.diff_versions.length ? "(Diff Version)" : "(no action)");

      // Update structures ///////////////////////////////////////////////////////
      if (apiData.structures && apiData.structures.length) {
        // First convert id to ObjectId type
        for (let i = 0; i < apiData.structures.length; i++) {
          apiData.structures[i] = reviseMongoObj(apiData.structures[i]);
        }

        // const ids = apiData.structures.map((v) => v._id);
        // await mongoAppClient.db('edxapp').collection('modulestore.structures').deleteMany({ "_id": { $in: ids } });
        await mongoAppClient.db(process.env.MONGO_DB_MAIN_NAME).collection("modulestore.structures").insertMany(apiData.structures, { ordered: false });

        // Insert once more for draft
        if (apiData.new_versions.length) {
          for (let i = 0; i < apiData.structures.length; i++) {
            delete apiData.structures[i]._id;
          }
          newDraftId = await mongoAppClient.db(process.env.MONGO_DB_MAIN_NAME).collection("modulestore.structures").insertMany(apiData.structures, { ordered: false });
          newDraftId = newDraftId.insertedIds["0"];
        }
      }

      // Update definitions ///////////////////////////////////////////////////////
      if (apiData.defs && apiData.defs.length) {
        for (let i = 0; i < apiData.defs.length; i++) {
          apiData.defs[i] = reviseMongoObj(apiData.defs[i]);
        }

        // const ids = apiData.defs.map((v) => v._id);
        // await mongoAppClient.db('edxapp').collection('modulestore.definitions').deleteMany({ "_id": { $in: ids } });
        await mongoAppClient.db(process.env.MONGO_DB_MAIN_NAME).collection("modulestore.definitions").insertMany(apiData.defs, { ordered: false });
      }

      // Insert new versions ///////////////////////////////////////////////////////
      if (apiData.new_versions && apiData.new_versions.length) {
        for (let i = 0; i < apiData.new_versions.length; i++) {
          apiData.new_versions[i] = reviseMongoObj(apiData.new_versions[i]);
          apiData.new_versions[i].versions["draft-branch"] = newDraftId;
        }
        console.log("[**** NEW VERSIONS ****]", apiData.new_versions);
        await mongoAppClient.db(process.env.MONGO_DB_MAIN_NAME).collection("modulestore.active_versions").insertMany(apiData.new_versions, { ordered: false });

        // Insert MySQL new item
        if (apiData.sql_data) {
          let fields = "",
            values = "",
            query = "",
            val = "";
          const DATE_KEYS = ["created", "modified", "start", "end", "start_date", "end_date"];

          for (let sk of Object.keys(apiData.sql_data)) {
            val = apiData.sql_data[sk];
            // console.log('[PAIR]', sk, ':', val, val != null, val != undefined, val != '', typeof val);
            if (val != null && val != undefined) {
              if (DATE_KEYS.includes(sk)) {
                if (!val) continue;
                val = _toSQLTime(new Date(val));
              }
              fields += `${sk}, `;
              values += typeof val == "string" ? `'${val}', ` : `${val}, `;
            }
          }

          if (fields && values) {
            fields = fields.slice(0, -2);
            values = values.slice(0, -2);
            query = `INSERT INTO course_overviews_courseoverview (${fields}) VALUES (${values})`;
            await sqlAppClient.query(query);
          }
        }
      }

      // Update different versions ///////////////////////////////////////////////////////
      if (apiData.diff_versions) {
        console.log("[**** DIFF VERSIONS ****]", apiData.diff_versions);
        for (let version of apiData.diff_versions) {
          await mongoAppClient
            .db(process.env.MONGO_DB_MAIN_NAME)
            .collection("modulestore.active_versions")
            .updateOne(
              {
                "search_targets.wiki_slug": version.wiki_slug,
              },
              {
                $set: {
                  "versions.published-branch": ObjectId(version.published_branch),
                  // "versions.draft-branch": ObjectId(version.published_branch)
                },
              }
            );
        }
      }
    } while (counter > 1);

    if (isEdited) {
      // await _cleanMongoCourses(mongoAppClient);
    }

    console.log("[********************************* sync course difference success! *********************************]");
  } catch (e) {
    console.log("[********************************* sync course difference error! *********************************]", e);
  } finally {
    mongoAppClient.close();
    sqlAppClient.quit();
  }
};

exports.correctMongoCourses = async () => {
  const sqlAppClient = _getSQLAppClient();
  const mongoAppClient = await _getMongoAppClient();

  try {
    let courses = await sqlAppClient.query(`SELECT id, display_name FROM course_overviews_courseoverview`);
    const { policies, moduleMapper } = await listGradePolicy(courses.map((e) => e.id));

    const incorrectCourses = [];
    for (let course of courses) {
      const policy = policies.find((v) => v.title == course.display_name);
      const mapper = moduleMapper.find((v) => v.courseTitle == course.display_name);

      if (!policy || !mapper || !mapper["mapper"]) {
        incorrectCourses.push(course);
      }
    }

    // Send email
    if (incorrectCourses.length) {
      const incorrectMapper = incorrectCourses.map((v) => `<li>${v.display_name}</li>`);
      const html = `
        <h2>Invalid course(s) detected. You need to refresh the grading system of the bellow course(s)</h2>
        <h3>Platform: ${process.env.REACT_APP_BASE_URL}</h3>
        <ul>
          ${incorrectMapper}
        </ul>
      `;

      await sendEmail("no-insert", "eg@eduforma.fr", "Invalid course(s) detected", html);
    }
  } catch (e) {
    console.log("[correct mongo courses error]", e);
  } finally {
    sqlAppClient.quit();
    mongoAppClient.close();
  }
};
