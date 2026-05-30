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
