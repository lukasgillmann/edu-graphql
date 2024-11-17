exports._getCertificateVariable = async (sqlAppClient) => {
  let query = "",
    res = "";

  query = `
    SELECT A.id
    FROM auth_user A
      LEFT JOIN course_creators_coursecreator B ON A.id = B.user_id
    WHERE A.is_staff = 0 AND A.is_superuser = 0 AND B.state = 'granted';
  `;
  res = await sqlAppClient.query(query);

  if (res.length) {
    const adminId = res[0].id;

    query = `
      SELECT signature_url
      FROM auth_userprofile
      WHERE user_id = ${adminId}
    `;
    res = await sqlAppClient.query(query);

    const signature_url = res.length ? res[0].signature_url : "";

    query = `
      SELECT id, comment, location, phone_number, contact_email, siret_number, sign_top, sign_bottom
      FROM certificate_variable
    `;
    res = await sqlAppClient.query(query);

    if (res.length) {
      return { ...res[0], signature_url };
    }
  }

  return {};
};
