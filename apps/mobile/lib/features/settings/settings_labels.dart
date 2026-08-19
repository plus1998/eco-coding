String contextWindowLimitLabel(int tokens) => switch (tokens) {
  131072 => '128K',
  262144 => '256K',
  524288 => '512K',
  1048576 => '1M',
  _ => '$tokens',
};

String maxOutputLimitLabel(int tokens) => switch (tokens) {
  8192 => '8K',
  16384 => '16K',
  32768 => '32K',
  65536 => '64K',
  131072 => '128K',
  262144 => '256K',
  _ => '$tokens',
};
