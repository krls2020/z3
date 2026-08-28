# Zerops on mobile

Zerops Code Mobile can sign in to your Zerops account and show projects from every organization you
belong to.

Open Settings → Zerops Account and sign in with your Zerops email and password. If your account uses
two-factor authentication, finish the login with a six-digit authenticator code or a recovery code.
The app stores the completed session in the device's protected credential storage. It does not save
your password, and an unfinished two-factor login is not restored after an app restart.

Open Settings → Projects to:

- switch between your Zerops organizations;
- select an active project and keep that selection for the next launch;
- inspect the project's runtimes, data services, infrastructure, status, and scaling limits;
- prefill the public address of the project's `zcp` service when adding an environment.

Connecting `zcp` still requires its one-time pairing code. Zerops account access proves which cloud
projects you may inspect; the pairing code separately authorizes this phone to control the coding
agent in one environment.

Password login, authenticator codes, and recovery codes are supported. Native passkey/security-key
login and GitHub/GitLab login are not currently available in the mobile app.
