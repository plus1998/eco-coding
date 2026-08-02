String contextWindowLimitLabel(int tokens) => switch (tokens) {
  131072 => '128K',
  204800 => '200K',
  262144 => '262K',
  524288 => '512K',
  1048576 => '1M',
  _ => '$tokens',
};
