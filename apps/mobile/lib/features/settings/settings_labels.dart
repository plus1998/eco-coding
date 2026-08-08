String contextWindowLimitLabel(int tokens) => switch (tokens) {
  131072 => '128K',
  204800 => '200K',
  262144 => '262K',
  524288 => '512K',
  1048576 => '1M',
  _ => '$tokens',
};

String maxOutputLimitLabel(int tokens) => switch (tokens) {
  8192 => '8K',
  16384 => '16K',
  32000 => '32K',
  64000 => '64K',
  128000 => '128K',
  _ => '$tokens',
};
