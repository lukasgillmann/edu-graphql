const { _getSQLAppClient } = require("../common/utility");

exports.editStudentAnswer = async (_, obj, ctx) => {
  const { userId, permission, is_ghost } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN", "USER"].indexOf(permission) < 0 || is_ghost) return false;

  const mysqlClient = _getSQLAppClient();

  try {
    let query = "",
      res = "";

    for (let inputItem of obj.input) {
      const { module_id, choices, course_id, raw_possible } = inputItem;

      query = `
        SELECT state, grade, max_grade FROM courseware_studentmodule
        WHERE student_id = ${userId} AND module_id = '${module_id}'
      `;

      res = await mysqlClient.query(query);

      if (res && res.length) {
        ////////////////////////////////////////////////////////////////////////////////
        res = res[0];
        let state = JSON.parse(res["state"]);

        // Update correct_map
        if (!state["correct_map"]) state["correct_map"] = {};
        if (!state["student_answers"]) state["student_answers"] = {};

        for (let cho of choices) {
          // If id is not valid, then continue
          if (state["input_state"] && Object.keys(state["input_state"]).length > 0) {
            if (!state["input_state"][cho.id]) continue;
          } else {
            state["input_state"] = { [cho.id]: {} };
          }

          let correctMapItem = state["correct_map"][cho.id];
          if (correctMapItem) {
            // If that item is exist in correct_map
            correctMapItem["correctness"] = cho.correctness;
          } else {
            // Else not exist, then add new one
            correctMapItem = {
              correctness: cho.correctness,
              npoints: null,
              msg: "",
              hint: "",
              hintmode: null,
              queuestate: null,
              answervariable: null,
            };
          }
          state["correct_map"][cho.id] = correctMapItem;

          // Update student_answers
          state["student_answers"][cho.id] = cho.student_answer;
        }

        // Update score
        let rawPossible = Object.keys(state["input_state"]).length;
        let rawEarned = 0;
        for (let key of Object.keys(state["correct_map"])) {
          if (state["correct_map"][key]["correctness"] == "correct") {
            rawEarned += 1;
          }
        }
        if (rawPossible != state["score"]["raw_possible"]) {
          // Raise Error
        }
        if (rawPossible > state["score"]["raw_possible"]) {
          // Raise Error
          state["score"]["raw_possible"] = rawPossible;
        }

        state["score"]["raw_earned"] = rawEarned;

        // Update attempts
        state["attempts"] = state["attempts"] + 1;

        // Update done
        if (rawPossible == rawEarned) {
          state["done"] = true;
        }

        // Update last_submission_time
        state["last_submission_time"] = new Date();

        if (!res["max_grade"]) res["max_grade"] = rawPossible;

        query = `
          UPDATE courseware_studentmodule
          SET state = '${JSON.stringify(state).replace(/"/g, '\\"')}', grade = ${rawEarned}, max_grade = ${res["max_grade"]}
          WHERE student_id = ${userId} AND module_id = '${module_id}'
        `;

        res = await mysqlClient.query(query);
      } else {
        //////////////////////////////////////////////////////////////////////////////////////////////////////
        const rawEarned = choices.filter((c) => c.correctness == "correct").length;
        const currDate = new Date().toISOString();
        const changedDate = currDate.replace("T", " ").replace("Z", "");

        let state = {
          input_state: {},
          seed: 1,
          score: {
            raw_earned: rawEarned,
            raw_possible: raw_possible,
          },
          correct_map: {},
          student_answers: {},
          attempts: 1,
          done: rawEarned == raw_possible ? true : false,
          last_submission_time: currDate,
        };

        for (let cho of choices) {
          state["input_state"][cho.id] = {};
          state["correct_map"][cho.id] = {
            correctness: cho.correctness,
            npoints: null,
            msg: "",
            hint: "",
            hintmode: null,
            queuestate: null,
            answervariable: null,
          };
          state["student_answers"][cho.id] = cho.student_answer;
        }

        query = `
          INSERT INTO courseware_studentmodule (module_type, module_id, course_id, state, grade, max_grade, done, created, modified, student_id)
          VALUES ('problem', '${module_id}', '${course_id}', '${JSON.stringify(state).replace(/"/g, '\\"')}', ${rawEarned}, ${raw_possible}, 'na', '${changedDate}', '${changedDate}', ${userId});
        `;

        await mysqlClient.query(query);
      }
    }

    return true;
  } catch (e) {
    console.log("[Edit history Err]", e);

    return false;
  } finally {
    mysqlClient.quit();
  }
};
