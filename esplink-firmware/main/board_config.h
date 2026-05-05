#pragma once

// 每款新产品只需修改这个文件，框架代码不动
//
// board_type  : 云端和小程序用它决定路由哪个功能页
// ui_page     : 小程序 device-page-registry 的 key
// features    : 设备能力列表（云端和小程序功能裁剪用）
// fw_version  : 语义版本，云端 OTA check 时做版本比较

#define BOARD_TYPE             "esplink-v1"
#define BOARD_UI_PAGE          "default"
#define BOARD_FIRMWARE_VERSION "1.0.0"

// 设备能力 JSON，整体上报给云端和小程序
// 注意：用字符串拼接宏，board_type / ui_page 保持单一来源
#define BOARD_CAPABILITIES_JSON                        \
    "{\"type\":\"" BOARD_TYPE "\","                    \
     "\"ui_page\":\"" BOARD_UI_PAGE "\","              \
     "\"features\":[]}"
