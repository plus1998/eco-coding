interface CodexOAuthLoginProps {
  status: { isLoggedIn: boolean; message: string };
  loggingIn?: boolean;
  onLoginClick?: () => void;
  onLogoutClick?: () => void;
}

export function CodexOAuthLogin({ status, loggingIn, onLoginClick, onLogoutClick }: CodexOAuthLoginProps) {
  return (
    <div className="codex-oauth-login">
      <div className="status">
        <span className={status.isLoggedIn ? "logged-in" : "logged-out"}>
          {status.message}
        </span>
      </div>

      {!status.isLoggedIn ? (
        <button
          onClick={onLoginClick}
          disabled={loggingIn}
          className="login-button"
        >
          {loggingIn ? "登录中..." : "登录 OpenAI 账号"}
        </button>
      ) : (
        <button
          onClick={onLogoutClick}
          className="logout-button"
        >
          退出登录
        </button>
      )}
    </div>
  );
}
