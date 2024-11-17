const { _getSQLAppClient, _getMongoLogClient, DEFAULT_OUTPUT, _jsonReplacer } = require("../common/utility");
const { _courseGradeList, _moduleTimeList } = require("./analysis");
const { _categoryList } = require("./category");
const { _getCertificateVariable } = require("./certificate_variable");
const { _listUserTimeChart, _listTrackChart } = require("./chart");
const { _coachList } = require("./coach");
const { _listUserComment, _listWholeComment } = require("./comment");
const { _listCourse } = require("./course");
const { _dashboardGet } = require("./dashboard");
const { _emailTemplateList, _emailLogList, _emailRecentLogList } = require("./email");
const { _listMeetingInspect } = require("./meet_inspect");
const { _listMeeting, _listMeetingRecording } = require("./meet_event");
const { _groupList } = require("./group");
const { _licenseList } = require("./license");
const { _listUserLastLogin, _listLoginHist } = require("./login_hist");
const { _getChatEnableFlag, _listChatUser } = require("./message");
const { _listNotification } = require("./notification");
const { _listPhysicalSession } = require("./physical_session");
const { _listReview } = require("./review");
const { _smsTemplateList } = require("./sms");
const { _termsGet } = require("./terms");
const { _themeList } = require("./theme");
const { _tutorList } = require("./tutor");
const { _userList, _userGet } = require("./user");
const { _toIsoString } = require("../common/time");

exports.adminDashboardGet = async (_, obj, ctx) => {
  const { userId, permission } = ctx;

  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return null;

  const sqlAppClient = _getSQLAppClient();
  const mongoHistClient = await _getMongoLogClient();

  const data = {
    user_get: {},
    course_list: DEFAULT_OUTPUT,
    category_list: DEFAULT_OUTPUT,
    theme_list: [],

    user_list: DEFAULT_OUTPUT,
    group_list: DEFAULT_OUTPUT,
    email_template_list: DEFAULT_OUTPUT,
    email_log_list: DEFAULT_OUTPUT,
    sms_template_list: DEFAULT_OUTPUT,
    sms_log_list: DEFAULT_OUTPUT,
    tutor_list: DEFAULT_OUTPUT,
    license_list: DEFAULT_OUTPUT,
    dashboard_get: {},
    meeting_list: [],
    coach_list: DEFAULT_OUTPUT,
    certificate_variable_get: {},

    chat_all_hist: [],
    chat_enabled: true,
    comment_list: DEFAULT_OUTPUT,
    review_list: DEFAULT_OUTPUT,
    physical_session_list: DEFAULT_OUTPUT,
  };

  try {
    const currTime = new Date().getTime();
    const step = 1000 * 60 * 60 * 24;

    const proUserGet = _userGet(sqlAppClient, userId, permission);
    const proListCourse = _listCourse(sqlAppClient, userId, 0, DEFAULT_OUTPUT.page_size);
    const proCategoryList = _categoryList(sqlAppClient, 0, DEFAULT_OUTPUT.page_size);
    const proThemeList = _themeList(sqlAppClient);
    const proUserList = _userList(sqlAppClient, mongoHistClient, userId, permission, 0, DEFAULT_OUTPUT.page_size);
    const proGroupList = _groupList(sqlAppClient, 0, DEFAULT_OUTPUT.page_size);
    const proEmailTempList = _emailTemplateList(sqlAppClient);
    const proEmailLogList = _emailLogList(sqlAppClient, mongoHistClient, 0, DEFAULT_OUTPUT.page_size);
    const proRecentLogList = _emailRecentLogList(sqlAppClient, mongoHistClient);
    const proSMSTempList = _smsTemplateList(sqlAppClient);
    // const proSMSLogList = _smsLogList(mongoHistClient, 0, DEFAULT_OUTPUT.page_size);
    const proTutorList = _tutorList(sqlAppClient, 0, DEFAULT_OUTPUT.page_size);
    const proLicenseList = _licenseList(sqlAppClient, 0, DEFAULT_OUTPUT.page_size);
    const proDashboardGet = _dashboardGet(sqlAppClient, mongoHistClient);
    const proListMeeting = _listMeeting(sqlAppClient, 0, DEFAULT_OUTPUT.page_size);
    const prolistMeetingRecording = _listMeetingRecording(sqlAppClient, "", 0, DEFAULT_OUTPUT.page_size);
    const proCoachList = _coachList(sqlAppClient, 0, DEFAULT_OUTPUT.page_size);
    const proCertVariable = _getCertificateVariable(sqlAppClient);
    const proChatEnable = _getChatEnableFlag(sqlAppClient);
    const proUserIdsLoggedInList = _listUserLastLogin(mongoHistClient);
    const proWholeCommentList = _listWholeComment(sqlAppClient, mongoHistClient, 0, DEFAULT_OUTPUT.page_size);
    const proReviewList = _listReview(sqlAppClient, 0, DEFAULT_OUTPUT.page_size);
    const proPhysicalSessionList = _listPhysicalSession(sqlAppClient, 0, DEFAULT_OUTPUT.page_size);
    const proTermGet = _termsGet(sqlAppClient);
    const proChatUserActive = _listChatUser(sqlAppClient, mongoHistClient, true, 0, DEFAULT_OUTPUT.page_size);
    const proChatUserInactive = _listChatUser(sqlAppClient, mongoHistClient, false, 0, DEFAULT_OUTPUT.page_size);
    const proTrackList = _listTrackChart(mongoHistClient, currTime - 7 * step, currTime);
    const proNotification = _listNotification(sqlAppClient, mongoHistClient);

    data.user_get = await proUserGet;
    data.course_list = await proListCourse;
    data.category_list = await proCategoryList;
    data.theme_list = await proThemeList;
    data.user_list = await proUserList;
    data.group_list = await proGroupList;
    data.email_template_list = await proEmailTempList;
    data.email_log_list = await proEmailLogList;
    data.recent_hist_list = await proRecentLogList;
    data.sms_template_list = await proSMSTempList;
    data.sms_log_list = {};
    data.tutor_list = await proTutorList;
    data.license_list = await proLicenseList;
    data.dashboard_get = await proDashboardGet;
    data.meeting_list = await proListMeeting;
    data.meet_recording_list = await prolistMeetingRecording;
    data.coach_list = await proCoachList;
    data.certificate_variable_get = await proCertVariable;
    data.chat_enabled = await proChatEnable;
    data.comment_list = await proWholeCommentList;
    data.review_list = await proReviewList;
    data.physical_session_list = await proPhysicalSessionList;
    data.term_get = await proTermGet;
    data.chat_user_list = await proChatUserActive;
    data.chat_user_list_archieved = await proChatUserInactive;
    data.track_chart_list = await proTrackList;
    data.notification_list = await proNotification;

    const userLastLoginList = await proUserIdsLoggedInList;
    for (let i = 0; i < data.user_list.data.length; i++) {
      const loginUser = userLastLoginList.find((v) => v.user_id == data.user_list.data[i].id);
      data.user_list.data[i]["last_login"] = loginUser ? loginUser.last_login : null;
    }

    return JSON.stringify(data, _jsonReplacer);
  } catch (e) {
    console.log("[admin dashboard error]", e);
    return JSON.stringify(data, _jsonReplacer);
  } finally {
    sqlAppClient.quit();
    mongoHistClient.close();
  }
};

exports.adminUserInspectGet = async (_, obj, ctx) => {
  const { permission } = ctx;

  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return null;

  const { user_id } = obj;

  const sqlAppClient = _getSQLAppClient();
  const mongoHistClient = await _getMongoLogClient();

  const data = {
    ana_login_history: DEFAULT_OUTPUT,
    ana_grade_per_course: DEFAULT_OUTPUT,
    ana_module: DEFAULT_OUTPUT,
    ana_meeting: DEFAULT_OUTPUT,
    user_chart: { total_module_spent: 0, total_quiz_spent: 0, total_virtual_spent: 0, total_replay_spent: 0, data: [] },
    user_comment_list: DEFAULT_OUTPUT,
  };

  try {
    const currTime = new Date().getTime();
    const day = 1000 * 60 * 60 * 24;

    data.ana_login_history = await _listLoginHist(mongoHistClient, user_id, 0, DEFAULT_OUTPUT.page_size);
    data.ana_grade_per_course = await _courseGradeList(sqlAppClient, mongoHistClient, user_id, 0, DEFAULT_OUTPUT.page_size);
    data.ana_module = await _moduleTimeList(sqlAppClient, mongoHistClient, user_id, 0, DEFAULT_OUTPUT.page_size);
    data.ana_meeting = await _listMeetingInspect(mongoHistClient, user_id, null, 0, DEFAULT_OUTPUT.page_size);
    data.user_chart = await _listUserTimeChart(mongoHistClient, user_id, currTime - 7 * day, currTime);
    data.user_comment_list = await _listUserComment(mongoHistClient, user_id, 0, DEFAULT_OUTPUT.page_size);

    return JSON.stringify(data, _jsonReplacer);
  } catch (e) {
    console.log("[admin inspect error]", e);
    return JSON.stringify(data, _jsonReplacer);
  } finally {
    sqlAppClient.quit();
    mongoHistClient.close();
  }
};

exports.adminUserReportGet = async (_, obj, ctx) => {
  const { userId, permission } = ctx;

  if (["SUPERADMIN", "STAFF", "ADMIN", "USER"].indexOf(permission) < 0) return null;

  const { user_id } = obj;

  if (permission == "USER" && Number(userId) != user_id) return null;

  const sqlAppClient = _getSQLAppClient();
  const mongoHistClient = await _getMongoLogClient();

  const data = {
    logs: DEFAULT_OUTPUT,
    modules: DEFAULT_OUTPUT,
  };

  try {
    data.logs = await _listLoginHist(mongoHistClient, user_id, 0, 10000);
    data.modules = await _moduleTimeList(sqlAppClient, mongoHistClient, user_id, 0, 10000);

    return JSON.stringify(data, _jsonReplacer);
  } catch (e) {
    console.log("[admin report error]", e);
    return JSON.stringify(data, _jsonReplacer);
  } finally {
    sqlAppClient.quit();
    mongoHistClient.close();
  }
};
