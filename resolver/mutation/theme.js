const { _uploadString2ProdS3 } = require("../common/aws");
const { _getInvertColor, _getSQLAppClient } = require("../common/utility");

exports.editTheme = async (_, obj, ctx) => {
  const { permission } = ctx;
  if (["SUPERADMIN", "STAFF", "ADMIN"].indexOf(permission) < 0) return false;

  const sqlAppClient = _getSQLAppClient();
  let res = "",
    query = "";

  const inputs = obj.input;
  if (!inputs || !Array.isArray(inputs) || !inputs.length) return false;

  try {
    for (let item of inputs) {
      query += `UPDATE theme SET \`value\` = '${item.value}' WHERE \`name\` = '${item.name}' AND \`default\`=0;`;
    }

    if (query) await sqlAppClient.query(query);

    // now list all the theme values
    query = "SELECT `name`, `value` FROM theme WHERE `default`=0";
    res = await sqlAppClient.query(query);

    // Upload theme to s3
    const theme = {};
    for (let item of res) theme[item.name] = item.value;

    const gradInvert = _getInvertColor(theme.grad_main1);

    let data = `
      .color-main1 { color: ${theme.color_main1} !important }
      .stroke-main1 { stroke: ${theme.color_main1} !important }
      .fill-main1 { fill: ${theme.color_main1} !important }
      .border-main1 { border-color: ${theme.color_main1} !important }
      .bg-main1 { background-color: ${theme.color_main1} !important }

      .color-main2 { color: ${theme.color_main2} !important }
      .border-main2 { border-color: ${theme.color_main2} !important }
      .bg-main2 { background-color: ${theme.color_main2} !important }

      .color-main3 { color: ${theme.color_main3} !important }
      .border-main3 { border-color: ${theme.color_main3} !important }
      .bg-main3 { background-color: ${theme.color_main3} !important }
      
      .vt-auth-opacity { opacity: ${theme.auth_modal_opacity || 1}; }
      .vt-auth-modal-bg-color { background-color: ${theme.auth_modal_bg_color} !important; }
      body.app, body.admin { background: linear-gradient(233.56deg, ${theme.grad_main1} -21.9%, #FFF5E0 46.72%, #F8F8F8 115.74%) }
      .dark body.app, .dark body.admin { background: linear-gradient(233.56deg, ${gradInvert} -21.9%, #202225 46.72%, #453232 115.74%) }
      .v-sidenav .v-bg-side-active .MuiListItemIcon-root, .v-sidenav .v-bg-side-active .v-side-symbol > span {
        color: ${theme.color_main1} !important;
      }
    `;

    if (theme.auth_bg_is_image == "1") {
      `https://s3.eu-west-3.amazonaws.com/${process.env.REACT_APP_S3_BUCKET_NAME}/dev/logo.png`
      data += `
        .vt-auth-bg {
          background-image: url(https://s3.eu-west-3.amazonaws.com/${process.env.REACT_APP_S3_BUCKET_NAME}/dev/auth_bg.png);
          background-size: cover;
          background-position: center;
        }
      `;
    } else {
      data += `
        .vt-auth-bg {
          background-color: ${theme.auth_bg_color}
        }
      `;
    }

    await _uploadString2ProdS3(process.env.REACT_APP_SITE_NAME, data);

    return true;
  } catch (e) {
    console.log("[Edit theme Err]", e);
    return false;
  } finally {
    sqlAppClient.quit();
  }
};
