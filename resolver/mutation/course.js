const { _courseId2Wiki } = require("../common/course");
const { _getSQLAppClient, _getMongoAppClient, _renderSQLValue } = require("../common/utility");
const { _listCoursePublishVersions, _getCourseStructureAndDefs } = require("../query/course");

exports.editCourseAddition = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return false;

  const { course_id, display_name, list, objective, short_description, category_id } = obj.input;

  if (!course_id) return false;

  const sqlAppClient = _getSQLAppClient();
  const mongoAppClient = await _getMongoAppClient();

  let query = "",
    res = [];
  try {
    // Objective
    query = `
      UPDATE course_overviews_courseoverview
      SET display_name=${_renderSQLValue(display_name)}, objective=${_renderSQLValue(objective)}, short_description = ${_renderSQLValue(short_description)}
      WHERE id='${course_id}';
      INSERT INTO category_course (course_id, category_id) 
      VALUES ('${course_id}', ${category_id}) 
      ON DUPLICATE KEY UPDATE category_id = ${category_id};
    `;
    await sqlAppClient.query(query);

    if (display_name) {
      let version = await mongoAppClient
        .db(process.env.MONGO_DB_MAIN_NAME)
        .collection("modulestore.active_versions")
        .find({ "search_targets.wiki_slug": _courseId2Wiki(course_id) })
        .limit(1)
        .toArray();
      version = version.length > 0 ? version[0]["versions"]["published-branch"] : "";

      await mongoAppClient
        .db(process.env.MONGO_DB_MAIN_NAME)
        .collection("modulestore.structures")
        .updateOne(
          { _id: version },
          {
            $set: {
              "blocks.0.fields.display_name": display_name,
            },
          }
        );
    }

    // Unit duration
    if (list && list.length) {
      query = `
        SELECT id, section_title, sequence_title, vertical_title, duration 
        FROM unit_duration
        WHERE course_id='${course_id}'
      `;
      res = await sqlAppClient.query(query);

      // Find list items that exist in result
      query = "";

      for (let i = 0; i < res.length; i++) {
        const { id, section_title, sequence_title, vertical_title } = res[i];
        const idx = list.findIndex((v) => v.section_title == section_title && v.sequence_title == sequence_title && v.vertical_title == vertical_title);

        if (idx >= 0) {
          query += `UPDATE unit_duration SET duration=${list[idx].duration} WHERE id=${id};`;
        }
      }

      if (query) {
        await sqlAppClient.query(query);
      }
      query = "";

      // Find items that does not exist in db
      const remains = res.length ? list.filter((v) => !res.find((vr) => v.section_title == vr.section_title && v.sequence_title == vr.sequence_title && v.vertical_title == vr.vertical_title)) : list;

      remains.forEach(({ section_title, sequence_title, vertical_title, duration }) => {
        query += `('${course_id}', '${section_title.replace(/'/g, "\\'")}', '${sequence_title.replace(/'/g, "\\'")}', '${vertical_title.replace(/'/g, "\\'")}', ${duration}), `;
      });

      if (query) {
        query = query.slice(0, -2);
        query = `INSERT INTO unit_duration (course_id, section_title, sequence_title, vertical_title, duration) VALUES ${query}`;
        await sqlAppClient.query(query);
      }
    }

    return true;
  } catch (e) {
    console.log("[unit duration edit error]", e);
    return false;
  } finally {
    sqlAppClient.quit();
    mongoAppClient.close();
  }
};

exports.deleteCourse = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN", "USER"].indexOf(permission) < 0) return false;

  const { course_id } = obj;

  const sqlAppClient = _getSQLAppClient();
  const mongoClient = await _getMongoAppClient();

  let query = "",
    res = "";
  try {
    query = `
      SELECT display_name
      FROM course_overviews_courseoverview
      WHERE id = '${course_id}'
    `;

    res = await sqlAppClient.query(query);

    if (res && res.length) {
      res = res[0];
    }

    query = `
        SET SESSION foreign_key_checks=OFF;
        DELETE FROM course_overviews_courseoverview WHERE id = '${course_id}';
        DELETE FROM category_course WHERE course_id = '${course_id}';
        DELETE A, B, C
        FROM learning_sequences_learningcontext A
            LEFT JOIN learning_sequences_coursecontext B ON B.learning_context_id = A.id 
            LEFT JOIN learning_sequences_publishreport C ON C.learning_context_id = A.id
        WHERE A.context_key = '${course_id}';
        DELETE FROM course_overviews_courseoverviewtab WHERE course_overview_id = '${course_id}';
        DELETE A, B
        FROM admin_panel_courserun A
            LEFT JOIN admin_panel_courserunenrollment B ON B.run_id_id = A.run_id 
        WHERE A.course_id = '${course_id}';
        DELETE FROM bookmarks_xblockcache WHERE id = '${course_id}';
        DELETE FROM bulk_email_optout WHERE course_id = '${course_id}';
        DELETE FROM calendar_sync_usercalendarsyncconfig WHERE course_key = '${course_id}';
        DELETE FROM calendar_sync_historicalusercalendarsyncconfig WHERE course_key = '${course_id}';
        DELETE FROM canvas_canvaslearnerassessmentdatatransmissionaudit WHERE course_id = '${course_id}';
        DELETE FROM canvas_canvaslearnerdatatransmissionaudit WHERE course_id = '${course_id}';
        DELETE FROM certificates_certificategenerationcoursesetting WHERE course_key = '${course_id}';
        DELETE FROM certificates_certificategenerationhistory WHERE course_id = '${course_id}';
        DELETE FROM certificates_certificatewhitelist WHERE course_id = '${course_id}';
        DELETE FROM certificates_generatedcertificate WHERE course_id = '${course_id}';
        DELETE FROM certificates_historicalgeneratedcertificate WHERE course_id = '${course_id}';
        DELETE FROM completion_blockcompletion WHERE course_key = '${course_id}';
        DELETE FROM consent_datasharingconsent WHERE course_id = '${course_id}';
        DELETE FROM consent_historicaldatasharingconsent WHERE course_id = '${course_id}';
        DELETE FROM course_goals_coursegoal WHERE course_key = '${course_id}';
        DELETE FROM course_groups_cohortmembership WHERE course_id = '${course_id}';
        DELETE FROM course_groups_coursecohortssettings WHERE course_id = '${course_id}';
        DELETE A, B, C
        FROM course_groups_courseusergroup A
            LEFT JOIN course_groups_courseusergroup_users B ON B.courseusergroup_id = A.id 
            LEFT JOIN course_groups_courseusergrouppartitiongroup C ON C.course_user_group_id = A.id 
        WHERE A.course_id = '${course_id}';
        DELETE FROM course_groups_unregisteredlearnercohortassignments WHERE course_id = '${course_id}';
        DELETE FROM course_modes_coursemode WHERE course_id = '${course_id}';
        DELETE FROM course_modes_coursemodesarchive WHERE course_id = '${course_id}';
        DELETE FROM course_overviews_courseoverviewimageset WHERE course_overview_id = '${course_id}';
        DELETE FROM course_overviews_historicalcourseoverview WHERE id = '${course_id}';
        DELETE FROM courseware_offlinecomputedgrade WHERE course_id = '${course_id}';
        DELETE FROM courseware_offlinecomputedgradelog WHERE course_id = '${course_id}';
        DELETE FROM courseware_studentfieldoverride WHERE course_id = '${course_id}';
        DELETE FROM courseware_studentmodule WHERE course_id = '${course_id}';
        DELETE FROM courseware_studentmodulehistory WHERE student_module_id = '${course_id}';
        DELETE FROM credit_creditcourse WHERE course_key = '${course_id}';
        DELETE FROM credit_crediteligibility WHERE course_id = '${course_id}';
        DELETE FROM credit_creditrequest WHERE course_id = '${course_id}';
        DELETE FROM credit_creditrequirement WHERE course_id = '${course_id}';
        DELETE FROM degreed_degreedlearnerdatatransmissionaudit WHERE course_id = '${course_id}';
        DELETE FROM discounts_discountpercentageconfig WHERE course_id = '${course_id}';
        DELETE FROM discounts_discountrestrictionconfig WHERE course_id = '${course_id}';
        DELETE FROM discussions_providerfilter WHERE course_id = '${course_id}';
        DELETE FROM django_comment_client_role WHERE course_id = '${course_id}';
        DELETE A, B
        FROM django_comment_client_role A
            LEFT JOIN django_comment_client_role_users B ON B.role_id = A.id 
        WHERE A.course_id = '${course_id}';
        DELETE FROM django_comment_common_coursediscussionsettings WHERE course_id = '${course_id}';
        DELETE FROM django_comment_common_discussionsidmapping WHERE course_id = '${course_id}';
        DELETE FROM program_enrollments_programcourseenrollment WHERE course_key = '${course_id}';
        DELETE FROM sap_success_factors_sapsuccessfactorslearnerdatatransmission3ce5 WHERE course_id = '${course_id}';
        DELETE FROM status_coursemessage WHERE course_key = '${course_id}';
        DELETE FROM student_anonymoususerid WHERE course_id = '${course_id}';
        DELETE FROM student_courseaccessrole WHERE course_id = '${course_id}';
        DELETE FROM student_courseenrollment_history WHERE course_id = '${course_id}';
        DELETE FROM student_courseenrollmentallowed WHERE course_id = '${course_id}';
        DELETE FROM student_entranceexamconfiguration WHERE course_id = '${course_id}';
        DELETE FROM student_userquizresult WHERE course_id = '${course_id}';
        DELETE FROM submissions_studentitem WHERE course_id = '${course_id}';
        DELETE A, B
        FROM teams_courseteam A
            LEFT JOIN teams_courseteammembership B ON B.team_id = A.id 
        WHERE A.course_id = '${course_id}';
        DELETE FROM user_api_usercoursetag WHERE course_id = '${course_id}';
        DELETE FROM verified_track_content_migrateverifiedtrackcohortssetting WHERE old_course_key = '${course_id}';
        DELETE FROM verified_track_content_verifiedtrackcohortedcourse WHERE course_key = '${course_id}';
        DELETE FROM verify_student_verificationdeadline WHERE course_key = '${course_id}';
        DELETE FROM video_config_coursehlsplaybackenabledflag WHERE course_id = '${course_id}';
        DELETE FROM video_config_coursevideotranscriptenabledflag WHERE course_id = '${course_id}';
        DELETE FROM video_config_courseyoutubeblockedflag WHERE course_id = '${course_id}';
        DELETE FROM video_config_migrationenqueuedcourse WHERE course_id = '${course_id}';
        DELETE FROM video_config_updatedcoursevideos WHERE course_id = '${course_id}';
        DELETE FROM waffle_utils_waffleflagcourseoverridemodel WHERE course_id = '${course_id}';
        DELETE FROM xapi_xapilearnerdatatransmissionaudit WHERE course_id = '${course_id}';
        DELETE FROM xblock_config_courseeditltifieldsenabledflag WHERE course_id = '${course_id}';
        DELETE FROM zoom_meeting_meetingdata WHERE course_id = '${course_id}';
        DELETE FROM zoom_meet_recording WHERE course_id = '${course_id}';
        DELETE FROM student_review WHERE course_id = '${course_id}';
        DELETE FROM student_router_track WHERE course_id = '${course_id}';
        DELETE FROM student_verticals_viewed WHERE course_id = '${course_id}';
        SET SESSION foreign_key_checks=ON;
      `;

    await sqlAppClient.query(query);

    const wikiId = _courseId2Wiki(course_id);
    res = await mongoClient.db(process.env.MONGO_DB_MAIN_NAME).collection("modulestore.active_versions").deleteOne({ "search_targets.wiki_slug": wikiId });

    return true;
  } catch (e) {
    console.log("[course delete error]", e);

    return false;
  } finally {
    sqlAppClient.quit();
    mongoClient.close();
  }
};

exports._cleanMongoCourses = async (mongoAppClient) => {
  console.log("[** cleaning mongo **]");

  let res = "";

  const versions = await mongoAppClient.db(process.env.MONGO_DB_MAIN_NAME).collection("modulestore.active_versions").find().toArray();

  const structureIds = [];
  for (let version of versions) {
    if (version.versions["published-branch"]) structureIds.push(version.versions["published-branch"]);
  }

  const definitionIds = [];
  const structures = await mongoAppClient
    .db(process.env.MONGO_DB_MAIN_NAME)
    .collection("modulestore.structures")
    .aggregate([{ $match: { _id: { $in: structureIds } } }])
    .toArray();

  for (let structure of structures) {
    const clone = { ...structure };

    // Make base structure
    if (clone.blocks) {
      for (let i = 0; i < clone.blocks.length; i++) {
        clone.blocks[i].edit_info.previous_version = null;
        clone.blocks[i].edit_info.update_version = null;
        clone.blocks[i].edit_info.source_version = null;

        definitionIds.push(clone.blocks[i].definition);
      }
    }

    // Insert base
    delete clone._id;
    clone.previous_version = null;
    clone.original_version = null;
    res = await mongoAppClient.db(process.env.MONGO_DB_MAIN_NAME).collection("modulestore.structures").insertOne(clone);
    const baseId = res.insertedId;

    // Prepare draft/published structure
    if (clone.blocks) {
      for (let i = 0; i < clone.blocks.length; i++) {
        clone.blocks[i].edit_info.previous_version = baseId;
        clone.blocks[i].edit_info.update_version = baseId;
        clone.blocks[i].edit_info.source_version = baseId;
      }
    }

    // Insert draft
    delete clone._id;
    res = await mongoAppClient.db(process.env.MONGO_DB_MAIN_NAME).collection("modulestore.structures").insertOne(clone);
    const draftId = res.insertedId;
    const proUpdateStructrure = mongoAppClient
      .db(process.env.MONGO_DB_MAIN_NAME)
      .collection("modulestore.structures")
      .updateOne(
        { _id: draftId },
        {
          $set: {
            original_version: draftId,
            previous_version: draftId,
          },
        }
      );

    // Insert published
    delete clone._id;
    clone.previous_version = baseId;
    clone.original_version = baseId;
    res = await mongoAppClient.db(process.env.MONGO_DB_MAIN_NAME).collection("modulestore.structures").insertOne(clone);
    const publishedId = res.insertedId;

    // Finally update active_versions
    const proUpdateVersion = mongoAppClient
      .db(process.env.MONGO_DB_MAIN_NAME)
      .collection("modulestore.active_versions")
      .updateOne(
        { "versions.published-branch": structure._id },
        {
          $set: {
            "versions.draft-branch": draftId,
            "versions.published-branch": publishedId,
          },
        }
      );

    await proUpdateStructrure;
    await proUpdateVersion;
  }

  // Make all definitions with original one by setting _id of itself to version fields
  res = await mongoAppClient.db(process.env.MONGO_DB_MAIN_NAME).collection("modulestore.definitions").find().toArray();
  for (let item of res) {
    const temp = { ...item };
    temp.edit_info.previous_version = temp._id;
    temp.edit_info.original_version = temp._id;
    await mongoAppClient.db(process.env.MONGO_DB_MAIN_NAME).collection("modulestore.definitions").updateOne({ _id: temp._id }, { $set: temp });
  }

  // Now remove the original structures
  await mongoAppClient
    .db(process.env.MONGO_DB_MAIN_NAME)
    .collection("modulestore.structures")
    .deleteMany({ _id: { $in: structureIds } });

  // Remove definitions that are not exist in structures
  await mongoAppClient
    .db(process.env.MONGO_DB_MAIN_NAME)
    .collection("modulestore.definitions")
    .deleteMany({ _id: { $nin: definitionIds } });

  console.log("[** cleaning mongo done **]");
};

exports.cleanMongoCourses = async (_, obj, ctx) => {
  const { permission } = ctx;

  if (["SUPERADMIN"].indexOf(permission) < 0) return {};

  const mongoAppClient = await _getMongoAppClient();

  try {
    await this._cleanMongoCourses(mongoAppClient);
    return true;
  } catch (e) {
    console.log("[mongo clean error]", e);
    return false;
  } finally {
    mongoAppClient.close();
  }
};

// Based on the input versions, compare to the current theme and return the different structure & definitions
// Only used in digital theme

exports.syncCourseDifferences = async (_, obj, ctx) => {
  const { permission } = ctx;

  console.log("[sync getting data...]");

  if (["SUPERADMIN", "STAFF", "ADMIN", "USER", "TESTUSER"].indexOf(permission) < 0) return {};

  const inputVersions = obj.input;

  if (!inputVersions || !Array.isArray(inputVersions)) return {};

  const mongoAppClient = await _getMongoAppClient();
  const sqlAppClient = _getSQLAppClient();

  try {
    const currVersions = await _listCoursePublishVersions(mongoAppClient);

    // now find different versions
    const news = [];
    const diffs = [];
    let counter = 0;

    let structures = "",
      defs = "",
      sql_data = "";

    for (let cv of currVersions) {
      if (!cv.search_targets.wiki_slug || !cv.versions["published-branch"]) continue;

      const iv = inputVersions.find((v) => v.wiki_slug == cv.search_targets.wiki_slug);

      if (!iv) {
        // If this is new version
        if (!structures) {
          news.push(cv);
          console.log("[* new entered *]", news);
          structures = await _getCourseStructureAndDefs(mongoAppClient, [{ wiki_slug: cv.search_targets.wiki_slug, published_branch: cv.versions["published-branch"] }]);

          if (structures) {
            defs = structures.defs;
            structures = structures.structures;
          }
        }
        counter += 1;
      } else if (cv.versions["published-branch"].toString() != iv.published_branch) {
        if (!structures) {
          diffs.push({ _id: cv._id, wiki_slug: cv.search_targets.wiki_slug, published_branch: cv.versions["published-branch"] });
          console.log("[* update entered *]", diffs);
          structures = await _getCourseStructureAndDefs(mongoAppClient, [{ wiki_slug: cv.search_targets.wiki_slug, published_branch: cv.versions["published-branch"] }]);

          if (structures) {
            defs = structures.defs;
            structures = structures.structures;
          }
        }
        counter += 1;
      }

      if (structures.length + defs.length > 5e6) {
        news.length = 0;
        diffs.length = 0;
        structures = "";
        counter -= 1;

        console.log("[length exceed]", structures.length + defs.length);
      }
    }

    // Get structures and def blocks with string format
    console.log("[****** RETURNING ****]", counter, news, diffs, structures.length, defs.length);

    if (!structures.length) return {};

    // ---------------------------- Generate SQL query for new coruse -------------------------------------
    if (news.length) {
      const wikiSlug = news[0].search_targets.wiki_slug;
      const courseId = `course-v1:${wikiSlug.replace(/\./g, "+")}`;
      let res = await sqlAppClient.query(`SELECT * FROM course_overviews_courseoverview WHERE id='${courseId}'`);

      if (res.length) {
        sql_data = JSON.stringify(res[0]);
      }
    }

    return {
      new_versions: JSON.stringify(news),
      diff_versions: JSON.stringify(diffs),
      structures,
      defs,
      counter,
      sql_data,
    };
  } catch (e) {
    console.log("[unit duration edit error]", e);
    return {};
  } finally {
    mongoAppClient.close();
    sqlAppClient.quit();
  }
};
