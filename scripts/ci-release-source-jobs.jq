def required_jobs:
  [
    "check",
    "test",
    "Test installation methods"
  ];

def required_native_jobs:
  [
    "Native build (linux, x64, baseline and modern)",
    "Native build (ubuntu-24.04, arm64)",
    "Native build (macos-15-intel, x64)",
    "Native build (macos-15-intel, x64)",
    "Native build (macos-14, arm64)",
    "Native build (windows-latest, x64)",
    "Native build (windows-latest, x64)"
  ];

([.jobs[] | select(.name as $name | required_jobs | index($name)) | .name] | sort) ==
  (required_jobs | sort) and
([.jobs[] | select(.name | startswith("Native build (")) | .name] | sort) ==
  (required_native_jobs | sort) and
all(
  .jobs[]
  | select(
      (.name as $name | required_jobs | index($name)) or
      (.name | startswith("Native build ("))
    );
  .conclusion == "success"
)
