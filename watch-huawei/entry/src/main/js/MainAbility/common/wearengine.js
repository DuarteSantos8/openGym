/*
 * Copyright (c) 2021 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * Version: lite wearable 5.0.2.306
 * Description: wearEngine SDK
 */

import wearengine from "@system.wearengine";

var WearEngineConst = {
  DELAY_FILEAPP_VALUE: "internal://app/", // Default file storage path of third-party apps
  DEFAULT_EMPTY_VALUE: "", // Default empty string
};
var ErrorCode = {
  ERROR_CODE_INVALID_ARGUMENT: 5, // Invalid argument
  ERROR_CODE_DEVICE_VERSION_NOT_SUPPORT: 13, // Device version is not supported
  MSG_ERROR_PING_WATCH_APP_NOT_EXIST: 200, // App has not been installed on the wearable device
  MSG_ERROR_PING_WATCH_APP_NOT_RUNNING: 201, // App has been installed but not opened
  MSG_ERROR_PING_WATCH_APP_EXIST_RUNNING: 202, // App has been installed and opened。
  MSG_ERROR_PING_OTHER: 203, // Other error
  MSG_ERROR_PING_PHONE_APP_NOT_EXIST: 204, // App has not been installed on the phone
  MSG_ERROR_PING_PHONE_APP_NOT_RUNNING: 205, // App has been installed on the phone
  MSG_ERROR_SEND_FAIL: 206, // Failed to send the message
  MSG_ERROR_SEND_SUCCESS: 207, // The message is sent successfully
  MSG_ERROR_CODE_VERSION_TOO_LOW: 208 // The wearEngine version of the watch is too early
};
var MessageType = {
  MESSAGE_TYPE_DATA: 0, // Text Messages
  MESSAGE_TYPE_FILE: 1, // File Messages
  MESSAGE_TYPE_OFFLINE_MSG: 2 // Offline Messages
};

var WEARENGINE_SERVICE_VISION_302 = 302;
var WEARENGINE_SERVICE_VISION_303 = 303;
var WEARENGINE_SERVICE_VISION_401 = 401;
var WEARENGINE_SDK_VERSION = "3";
var FILE_PUNLIC_PATH_INTERCETPED = 15;
var DEFAULT_EMPTY_FINGERPRINT = " ";
var isTransferring = false;

var P2pClient = (function() {
  var peerPkgName;
  var peerFingerPrint;
  var version;

  function P2pClient() {
    try {
      var jsSdk = this;
      var getVersionCallBack = function(data) {
        if (data) {
          var versionArray = data.split(".");
          jsSdk.version = versionArray[versionArray.length - 1];
          console.info("service sdk version is: " + data);
        } else {
          jsSdk.version = 0;
          console.info("get service sdk version failed");
        }
      };
      wearengine.getWearEngineVersion({
        complete: getVersionCallBack,
        sdkVersion: WEARENGINE_SDK_VERSION
      });
    } catch (error) {
      jsSdk.version = 0;
      console.info("service sdk version is too low" + error.message);
    }
  }
  /**
   * Set the package name of the phone app
   * peerPkgName: string
   */
  P2pClient.prototype.setPeerPkgName = function(peerPkgName) {
    var successCallBack = function() {
      console.info("setPeerPkgName success.");
    };
    var failCallBack = function() {
      console.info("setPeerPkgName fail.");
    };
    this.peerPkgName = peerPkgName;
    if (this.version < WEARENGINE_SERVICE_VISION_303) {
      console.info("ERROR_CODE_VERSION_TOO_LOW setPackageName is invalid");
      return;
    }
    wearengine.setPackageName({
      appName: peerPkgName,
      complete: successCallBack,
      fail: failCallBack
    });
  };
  /**
   * Set the app fingerprint information on the phone
   * fingerPrint: string
   */
  P2pClient.prototype.setPeerFingerPrint = function(fingerPrint) {
    if (this.version < WEARENGINE_SERVICE_VISION_302) {
      console.info("setPeerFingerPrint interface invalid");
      var obj = {
        data: "ERROR_CODE_VERSION_TOO_LOW",
        code: ErrorCode.MSG_ERROR_CODE_VERSION_TOO_LOW
      };
      return obj;
    }
    if (isEmpty(fingerPrint)) {
      fingerPrint = DEFAULT_EMPTY_FINGERPRINT;
    }
    this.peerFingerPrint = fingerPrint;
    var successCallBack = function() {
      console.info("setPeerFingerPrint success.");
    };
    var failCallBack = function() {
      console.error("setPeerFingerPrint failed.");
    };
    wearengine.setFingerprint({
      appName: this.peerPkgName,
      appCert: fingerPrint,
      complete: successCallBack,
      fail: failCallBack
    });
  };
  /**
   * Check whether the specified application has been installed on the peer device
   * pingCallback: object:onSuccess(),onFailure(),onPingResult(resultCode)
   */
  P2pClient.prototype.ping = function(pingCallback) {
    var successCode = {
      data: " ERROR_CODE_P2P_PHONE_APP_EXIST",
      code: ErrorCode.MSG_ERROR_PING_PHONE_APP_NOT_RUNNING
    };
    var successCallBack = function() {
      pingCallback.onSuccess();
      pingCallback.onPingResult(successCode);
      console.info("ping success.");
    };
    var notInstallCode = {
      data: "ERROR_CODE_P2P_PHONE_APP_NOT_EXIST",
      code: ErrorCode.MSG_ERROR_PING_PHONE_APP_NOT_EXIST
    };
    var failCode = {
      data: "ERROR_CODE_P2P_OTHER_ERROR",
      code: ErrorCode.MSG_ERROR_PING_OTHER
    };
    if (isEmpty(this.peerPkgName)) {
      pingCallback.onFailure();
      pingCallback.onPingResult(notInstallCode);
      return;
    }
    var failCallBack = function(data, code) {
      if (!data && !code) {
        pingCallback.onFailure();
        pingCallback.onPingResult(notInstallCode);
      } else {
        pingCallback.onFailure();
        pingCallback.onPingResult(failCode);
      }
      console.error("ping failed.");
    };

    if (this.version >= WEARENGINE_SERVICE_VISION_401) {
      wearengine.detect({
        bundleName: this.peerPkgName,
        success: successCallBack,
        fail: failCallBack
      });
    } else {
      FeatureAbility.detect({
        bundleName: this.peerPkgName,
        success: successCallBack,
        fail: failCallBack
      });
    }
  };
  /**
   * Register message listener
   * receiver：object:onSuccess(),onFailure(),onReceiveMessage(message)
   */
  P2pClient.prototype.registerReceiver = function(receiver) {
    if (!receiver) {
      receiver.onReceiveMessage(
        {
          isFileType: false,
          message: "receiver is null",
        }
      );
      return;
    }
    if (this.version > WEARENGINE_SERVICE_VISION_302) {
      if (isEmpty(this.peerPkgName)) {
        console.error("peerPkgName cannot be empty");
        receiver.onFailure();
        return;
      }
      var setPeerPkgNameSuccessCallBack = function() {
        console.info("registerReceiver setPeerPkgName success.");
      };
      var setPeerPkgNameFailCallBack = function() {
        console.info("registerReceiver setPeerPkgName fail.");
        return;
      };
      wearengine.setPackageName({
        appName: this.peerPkgName,
        complete: setPeerPkgNameSuccessCallBack,
        fail: setPeerPkgNameFailCallBack
      });
    }
    if (isEmpty(this.peerFingerPrint)) {
      console.error("peerFingerPrint cannot be empty");
      receiver.onFailure();
      return;
    }
    var successCallBack = function(data) {
      if (data) {
        if (data.isRegister) {
          receiver.onSuccess();
        } else if (data.isFileType){
          var fileObj = {
            isFileType: true,
            name: data.file,
            mode: "",
            mode2: ""
          };
          receiver.onReceiveMessage(fileObj);
          console.info("receive file name:" + fileObj.name);
        } else {
          receiver.onReceiveMessage(data.message);
          console.info("receive message:" + data.message);
        }
      } else {
        receiver.onSuccess();
      }
    };
    if (this.version >= WEARENGINE_SERVICE_VISION_401) {
      wearengine.unsubscribeMsg();
      wearengine.subscribeMsg({
        success: successCallBack,
        fail: receiver.onFailure
      });
    } else {
      FeatureAbility.subscribeMsg({
        success: successCallBack,
        fail: receiver.onFailure
      });
    }
  };
  /**
   * Send messages
   * message: Message
   * sendCallback: object:onSuccess(),onFailure(),onSendResult(resultCode),onSendProgress(count)
   * resultCode: SUCCESS 207, FAILURE 206
   */
  P2pClient.prototype.send = function(message, sendCallback) {
    if (!message || !sendCallback) {
      return;
    }

    var failCode = {
        data: "peerPkgName or peerFingerPrint empty",
        code: ErrorCode.MSG_ERROR_SEND_FAIL
    };
    if (isEmpty(this.peerPkgName) || isEmpty(this.peerFingerPrint)) {
        console.error("peerPkgName or peerFingerPrint cannot be empty");
        sendCallback.onFailure();
        sendCallback.onSendResult(failCode);
        return;
    }

    if (message.getType() == MessageType.MESSAGE_TYPE_DATA) {
      var successCallBack = function() {
        var successCode = {
          data: "ERROR_CODE_COMM_SUCCESS",
          code: ErrorCode.MSG_ERROR_SEND_SUCCESS
        };
        sendCallback.onSuccess();
        sendCallback.onSendResult(successCode);
        sendCallback.onSendProgress(100 + "%");
        console.info("send message success.");
      };

      var failCallBack = function(errorMessage, code) {
        var failCode = {
          data: errorMessage,
          code: ErrorCode.MSG_ERROR_SEND_FAIL
        };
        sendCallback.onFailure();
        sendCallback.onSendResult(failCode);
        sendCallback.onSendProgress(0 + "%");
        console.error("send message failed.");
      };
      if (this.version >= WEARENGINE_SERVICE_VISION_401) {
        wearengine.sendMsg({
          deviceId: "remote",
          bundleName: this.peerPkgName,
          abilityName: "",
          message: message.getData(),
          success: successCallBack,
          fail: failCallBack
        });
      } else {
        FeatureAbility.sendMsg({
          deviceId: "remote",
          bundleName: this.peerPkgName,
          abilityName: "",
          message: message.getData(),
          success: successCallBack,
          fail: failCallBack
        });
      }
    } else {
      if (this.version < WEARENGINE_SERVICE_VISION_302) {
        console.info("not support send file");
        var obj = {
          data: "ERROR_CODE_VERSION_TOO_LOW",
          code: ErrorCode.MSG_ERROR_CODE_VERSION_TOO_LOW
        };
        sendCallback.onFailure();
        sendCallback.onSendResult(obj);
        return;
      }

      var fileName = message.getFile().name;
      // Service version earlier than 303 does not support the internal://app/ directory
      if (this.version < WEARENGINE_SERVICE_VISION_303) {
        var TempPath = fileName.substring(0, FILE_PUNLIC_PATH_INTERCETPED);
        if (TempPath == WearEngineConst.DELAY_FILEAPP_VALUE) {
          var obj = {
            data: "ERROR_CODE_VERSION_TOO_LOW",
            code: ErrorCode.MSG_ERROR_CODE_VERSION_TOO_LOW
          };
          sendCallback.onFailure();
          sendCallback.onSendResult(obj);
          console.info("wearEngine service version too low, file path not support");
          return;
        }
      }
      var successCallBack = function() {
        var successCode = {
          data: "ERROR_CODE_COMM_SUCCESS",
          code: ErrorCode.MSG_ERROR_SEND_SUCCESS
        };
        sendCallback.onSuccess();
        sendCallback.onSendResult(successCode);
        console.info("send file success.");
        isTransferring = false;
      };

      var failCallBack = function(errorMessage, code) {
        var failCode = {
          data: errorMessage,
          code: ErrorCode.MSG_ERROR_SEND_FAIL
        };
        sendCallback.onFailure();
        sendCallback.onSendResult(failCode);
        console.info("send file failed.");
        isTransferring = false;
      };
      if (isTransferring) {
        console.error("send file failed,there is already a file being sent.");
        failCallBack();
        return;
      }
      isTransferring = true;

      var progressCallBack = function(data) {
        sendCallback.onSendProgress(data.progressNum + "%");
        console.info("progress of sending file: " + data.progressNum + "%");
      };

      wearengine.uploadFile({
        fileName: fileName,
        filePath: this.peerPkgName,
        peerPackageName: this.peerPkgName,
        success: successCallBack,
        fail: failCallBack,
        progress: progressCallBack
      });
    }
  };
  /**
   * Deregister message listener
   * receiver: onSuccess()
   */
  P2pClient.prototype.unregisterReceiver = function(receiver) {
    if (this.version >= WEARENGINE_SERVICE_VISION_401) {
      wearengine.unsubscribeMsg();
    } else {
      FeatureAbility.unsubscribeMsg();
    }
    receiver.onSuccess();
  };
  /**
   * Check whether the parameter is empty
   * parameter: string
   */
  function isEmpty(parameter) {
    return parameter == "undefined" || parameter == null || parameter == "" || parameter == " ";
  }
  return P2pClient;
})();

/**
 * File format type
 * name: file name with path
 * mode: 'text' or 'binary'
 * mode2: 'R', 'W', 'RW'
 */
var File = (function() {
  var name;
  var mode;
  var mode2;

  function File() {}

  return File;
})();

var Builder = (function() {
  var messageInfo;

  function Builder() {}

  Builder.prototype.setDescription = function(description) {
      this.messageInfo = description;
      this.messageType = MessageType.MESSAGE_TYPE_DATA;
  };
  /**
   * Set the message information (either of the two formats)
   * data: ArrayBuffer
   * data: File（Not supported currently）
   */
  Builder.prototype.setPayload = function(data) {
      if (!data) {
          return;
      }
      if (typeof data == "object" && data.name) {
          this.messageType = MessageType.MESSAGE_TYPE_FILE;
          return this.setFilePlayload(data);
      } else {
          this.messageType = MessageType.MESSAGE_TYPE_DATA;
          return this.setBufferPlayload(data);
      }
  };
  Builder.prototype.setBufferPlayload = function(data) {
      this.messageInfo = String.fromCharCode.apply(null, new Uint16Array(data));
  };
  Builder.prototype.setFilePlayload = function(data) {
      this.messageInfo = JSON.stringify(data);
  };
  return Builder;
})();

var Message = (function() {
  var builder = new Builder();

  function Message() {}

  Message.prototype.describeContents = function() {
    return this.builder.messageInfo;
  };
  /**
   * Get information during transmission
   */
  Message.prototype.getData = function() {
    return this.builder.messageInfo;
  };
  Message.prototype.getDescription = function() {
    return this.builder.messageInfo;
  };
  /**
   * Get File Information
   */
  Message.prototype.getFile = function() {
    if (this.builder.messageType == MessageType.MESSAGE_TYPE_FILE) {
        return JSON.parse(this.builder.messageInfo);
    }
    return null;
  };
  /**
   * Get the transmission data type
   * 0 string
   * 1 File
   */
  Message.prototype.getType = function() {
      return this.builder.messageType;
  };
  return Message;
})();

var PeerDeviceClient = (function () {
  var version;
  function PeerDeviceClient() {
    try {
      var jsSdk = this;
      var getVersionCallBack = function(data) {
        if (data) {
          var versionArray = data.split(".");
          jsSdk.version = versionArray[versionArray.length - 1];
          console.info("service sdk version is: " + data);
        } else {
          jsSdk.version = 0;
          console.info("get service sdk version failed");
        }
      };
      wearengine.getWearEngineVersion({
        complete: getVersionCallBack,
        sdkVersion: WEARENGINE_SDK_VERSION
      });
    } catch (error) {
      jsSdk.version = 0;
      console.info("service sdk version is too low" + error.message);
    }
  }

 /**
   * Get the peer device object
   * sendCallback: object:onSuccess(data),onFailure(data)
   */
  PeerDeviceClient.prototype.getPeerDevice = function (peerDeviceCallback) {
    if (!peerDeviceCallback) {
      console.error("getPeerDevice peerDeviceCallback is null");
      var obj = {
        data: "ERROR_CODE_INVALID_ARGUMENT",
        errorCode: ErrorCode.ERROR_CODE_INVALID_ARGUMENT
      };
      return obj;
    }

    if (this.version < WEARENGINE_SERVICE_VISION_401) {
      console.error("getPeerDevice wearengine service verison is low");
      var obj = {
        data: "ERROR_CODE_DEVICE_VERSION_NOT_SUPPORT",
        errorCode: ErrorCode.ERROR_CODE_DEVICE_VERSION_NOT_SUPPORT
      };
      peerDeviceCallback.onFailure(obj);
      return;
    }

    var successCallBack = function(data) {
      peerDeviceCallback.onSuccess(data);
    };
    var failCallBack = function(data) {
      peerDeviceCallback.onFailure(data);
    };

    wearengine.getPeerDevice({
      success: successCallBack,
      fail: failCallBack
    });

    return;
  };

  return PeerDeviceClient;
})();

export { P2pClient, Message, Builder, PeerDeviceClient };
