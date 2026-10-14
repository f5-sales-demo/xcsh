def required_jobs:
  if any(.jobs[]; .name == "TypeScript tests (native-dependent)") then
    ["check", "TypeScript tests (native-independent)", "TypeScript tests (native-dependent)", "Test installation methods"]
  else
    ["check", "test", "Test installation methods"]
  end;

def required_native_jobs:
  [
    "Native build (linux, x64, baseline)",
    "Native build (linux, x64, modern)",
    "Native build (ubuntu-24.04, arm64)",
    "Native build (macos-15-intel, x64)",
    "Native build (macos-15-intel, x64)",
    "Native build (macos-14, arm64)",
    "Native build (windows-latest, x64)",
    "Native build (windows-latest, x64)"
  ];

required_jobs as $required |
([.jobs[] | select(.name as $name | $required | index($name)) | .name] | sort) ==
  ($required | sort) and
([.jobs[] | select(.name | startswith("Native build (")) | .name] | sort) ==
  (required_native_jobs | sort) and
all(
  .jobs[]
  | select(
      (.name as $name | $required | index($name)) or
      (.name | startswith("Native build ("))
    );
  .conclusion == "success"
)
