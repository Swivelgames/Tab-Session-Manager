import browser from "webextension-polyfill";
import axios from "axios";
import log from "loglevel";
import { clientId, clientSecret } from "../credentials";
import { getSettings, setSettings } from "../settings/settings";

const logDir = "background/cloudAuth";

export const signInGoogle = async () => {
  log.log(logDir, "signInGoogle()");
  try {
    const authCode = await getAuthCode();
    const { accessToken, expiresIn, refreshToken } = await getRefreshTokens(authCode);
    const email = await getEmail(accessToken);
    setSettings("signedInEmail", email);
    setSettings("accessToken", accessToken);
    setSettings("refreshToken", refreshToken);
    setTokenExpiration(expiresIn);
    setSettings("lastSyncTime", 0);
    setSettings("removedQueue", []);
    return true;
  } catch {
    return false;
  }
};

export const signOutGoogle = async () => {
  log.log(logDir, "signOutGoogle()");
  try {
    const accessToken = getSettings("accessToken");
    revokeToken(accessToken);
    setSettings("signedInEmail", "");
    setSettings("accessToken", "");
    setSettings("refreshToken", "");
    setSettings("lastSyncTime", 0);
    setSettings("removedQueue", []);
    return true;
  } catch {
    return false;
  }
};

const getAuthCode = async () => {
  const scopes = [
    "https://www.googleapis.com/auth/drive.appfolder",
    "https://www.googleapis.com/auth/userinfo.email"
  ];
  const redirectUri = browser.identity.getRedirectURL();
  const authURL =
    "https://accounts.google.com/o/oauth2/v2/auth" +
    `?client_id=${clientId}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(scopes.join(" "))}` +
    `&access_type=offline`;

  const redirectedURL = await browser.identity.launchWebAuthFlow({
    url: authURL,
    interactive: true
  }).catch(async e => {
    log.error(logDir, "getAuthCode()", e);
    throw new Error();
  });

  const params = new URL(redirectedURL.replace("#", "?")).searchParams;
  if (params.has("error")) {
    log.error(logDir, "getAuthCode()", params.get("error"));
    throw new Error();
  }

  return params.get("code");
};

const getRefreshTokens = async authCode => {
  const options = {
    method: "post",
    url: "https://www.googleapis.com/oauth2/v4/token",
    params: {
      client_id: clientId,
      client_secret: clientSecret,
      code: authCode,
      grant_type: "authorization_code",
      redirect_uri: browser.identity.getRedirectURL()
    }
  };

  const result = await axios(options)
    .catch(e => {
      log.error(logDir, "getRefreshTokens()", e.response);
      throw new Error();
    });

  return {
    accessToken: result.data.access_token,
    expiresIn: result.data.expires_in,
    refreshToken: result.data.refresh_token
  };
};

const getAccessToken = async refreshToken => {
  const options = {
    method: "post",
    url: "https://www.googleapis.com/oauth2/v4/token",
    params: {
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken
    }
  };

  const result = await axios(options)
    .catch(e => {
      log.error(logDir, "getAccessToken()", e.response);
      throw new Error();
    });

  return {
    accessToken: result.data.access_token,
    expiresIn: result.data.expires_in
  };
};

const getEmail = async accessToken => {
  const url = "https://www.googleapis.com/oauth2/v1/userinfo" + `?access_token=${accessToken}`;
  const response = await axios.get(url);
  return response.data.email;
};

const setTokenExpiration = async expirationSec => {
  const currentTimeMs = Date.now();
  setSettings("tokenExpiration", currentTimeMs + expirationSec * 1000);
};

export const refreshAccessToken = async () => {
  const currentAccessToken = getSettings("accessToken");
  const tokenExpiration = getSettings("tokenExpiration");
  if (Date.now() < tokenExpiration) return currentAccessToken;

  log.log(logDir, "refreshAccessToken()");
  const refreshToken = getSettings("refreshToken");

  if (refreshToken) {
    const { accessToken, expiresIn } = await getAccessToken(refreshToken);
    setSettings("accessToken", accessToken);
    setTokenExpiration(expiresIn);
    return accessToken;
  } else {
    const authCode = await getAuthCode();
    const { accessToken, expiresIn, refreshToken } = await getRefreshTokens(authCode);
    const email = await getEmail(accessToken);
    setSettings("signedInEmail", email);
    setSettings("accessToken", accessToken);
    setSettings("refreshToken", refreshToken);
    setTokenExpiration(expiresIn);
    return accessToken;
  }
};

const revokeToken = async token => {
  let params = new URLSearchParams();
  params.append("token", token);
  await axios.post(`https://oauth2.googleapis.com/revoke`, params);
};
