/**
 * Lightweight Zero-dependency Cognito Client
 * CognitoのJSON RPC 1.1 APIと直接通信を行い、Amplify等の巨大ライブラリを不要にします。
 */

export interface CognitoConfig {
  clientId: string;
  region: string;
}

export interface SignInResponse {
  accessToken?: string;
  idToken?: string;
  refreshToken?: string;
  challengeName?: 'NEW_PASSWORD_REQUIRED' | string;
  session?: string;
  error?: string;
}

/**
 * Cognitoエンドポイントに対してリクエストを送信するヘルパー
 */
async function cognitoRequest(region: string, target: string, payload: any): Promise<any> {
  const url = `https://cognito-idp.${region}.amazonaws.com/`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || data.__type || 'Unknown Cognito Error');
  }

  return data;
}

/**
 * ログイン要求 (USER_PASSWORD_AUTH)
 */
export async function cognitoSignIn(
  email: string,
  password: string,
  config: CognitoConfig
): Promise<SignInResponse> {
  try {
    const data = await cognitoRequest(config.region, 'InitiateAuth', {
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: config.clientId,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
      },
    });

    if (data.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
      return {
        challengeName: 'NEW_PASSWORD_REQUIRED',
        session: data.Session,
      };
    }

    const authResult = data.AuthenticationResult;
    return {
      accessToken: authResult.AccessToken,
      idToken: authResult.IdToken,
      refreshToken: authResult.RefreshToken,
    };
  } catch (err: any) {
    return { error: err.message };
  }
}

/**
 * 初回仮パスワード変更の回答 (RespondToAuthChallenge)
 */
export async function cognitoRespondToNewPasswordRequired(
  email: string,
  newPassword: string,
  session: string,
  config: CognitoConfig
): Promise<SignInResponse> {
  try {
    const data = await cognitoRequest(config.region, 'RespondToAuthChallenge', {
      ChallengeName: 'NEW_PASSWORD_REQUIRED',
      ClientId: config.clientId,
      ChallengeResponses: {
        USERNAME: email,
        NEW_PASSWORD: newPassword,
      },
      Session: session,
    });

    const authResult = data.AuthenticationResult;
    return {
      accessToken: authResult.AccessToken,
      idToken: authResult.IdToken,
      refreshToken: authResult.RefreshToken,
    };
  } catch (err: any) {
    return { error: err.message };
  }
}

/**
 * リフレッシュトークンを用いたトークンの再発行 (InitiateAuth - REFRESH_TOKEN_AUTH)
 */
export async function cognitoRefreshToken(
  refreshToken: string,
  config: CognitoConfig
): Promise<SignInResponse> {
  try {
    const data = await cognitoRequest(config.region, 'InitiateAuth', {
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: config.clientId,
      AuthParameters: {
        REFRESH_TOKEN: refreshToken,
      },
    });

    const authResult = data.AuthenticationResult;
    return {
      accessToken: authResult.AccessToken,
      idToken: authResult.IdToken,
      // APIの返却値に新しいリフレッシュトークンが含まれない場合は元のトークンを維持
      refreshToken: authResult.RefreshToken || refreshToken,
    };
  } catch (err: any) {
    return { error: err.message };
  }
}

/**
 * リフレッシュトークンの無効化 (RevokeToken)
 */
export async function cognitoRevokeToken(
  refreshToken: string,
  config: CognitoConfig
): Promise<{ success: boolean; error?: string }> {
  try {
    await cognitoRequest(config.region, 'RevokeToken', {
      ClientId: config.clientId,
      Token: refreshToken,
    });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * ArrayBufferをBase64URL文字列に変換します
 */
export function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = window.btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Base64URL文字列をArrayBufferに変換します
 */
export function base64UrlToArrayBuffer(base64Url: string): ArrayBuffer {
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * パスキー登録の開始 (StartWebAuthnRegistration)
 */
export async function cognitoStartWebAuthnRegistration(
  accessToken: string,
  config: CognitoConfig
): Promise<any> {
  return await cognitoRequest(config.region, 'StartWebAuthnRegistration', {
    AccessToken: accessToken,
  });
}

/**
 * パスキー登録の完了 (CompleteWebAuthnRegistration)
 */
export async function cognitoCompleteWebAuthnRegistration(
  accessToken: string,
  credential: any,
  config: CognitoConfig
): Promise<any> {
  return await cognitoRequest(config.region, 'CompleteWebAuthnRegistration', {
    AccessToken: accessToken,
    Credential: credential,
  });
}

/**
 * パスキーログイン要求 (InitiateAuth - USER_AUTH)
 */
export async function cognitoInitiateUserAuth(email: string, config: CognitoConfig): Promise<any> {
  return await cognitoRequest(config.region, 'InitiateAuth', {
    AuthFlow: 'USER_AUTH',
    ClientId: config.clientId,
    AuthParameters: {
      USERNAME: email,
      PREFERRED_CHALLENGE: 'WEB_AUTHN',
    },
  });
}

/**
 * パスキー認証のチャレンジ応答 (RespondToAuthChallenge - WEB_AUTHN)
 */
export async function cognitoRespondToWebAuthnChallenge(
  email: string,
  session: string,
  credential: any,
  config: CognitoConfig
): Promise<SignInResponse> {
  try {
    const data = await cognitoRequest(config.region, 'RespondToAuthChallenge', {
      ChallengeName: 'WEB_AUTHN',
      ClientId: config.clientId,
      ChallengeResponses: {
        USERNAME: email,
        CREDENTIAL: JSON.stringify(credential),
      },
      Session: session,
    });

    const authResult = data.AuthenticationResult;
    return {
      accessToken: authResult.AccessToken,
      idToken: authResult.IdToken,
      refreshToken: authResult.RefreshToken,
    };
  } catch (err: any) {
    return { error: err.message };
  }
}

/**
 * 登録されているWebAuthn認証情報の一覧を取得 (ListWebAuthnCredentials)
 */
export async function cognitoListWebAuthnCredentials(
  accessToken: string,
  config: CognitoConfig
): Promise<any> {
  return await cognitoRequest(config.region, 'ListWebAuthnCredentials', {
    AccessToken: accessToken,
  });
}

/**
 * 登録されているWebAuthn認証情報を削除 (DeleteWebAuthnCredential)
 */
export async function cognitoDeleteWebAuthnCredential(
  accessToken: string,
  credentialId: string,
  config: CognitoConfig
): Promise<any> {
  return await cognitoRequest(config.region, 'DeleteWebAuthnCredential', {
    AccessToken: accessToken,
    CredentialId: credentialId,
  });
}
