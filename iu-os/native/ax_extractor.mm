#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <Foundation/Foundation.h>
#include <node_api.h>

// Helper: Convert AXValue to CGPoint/CGSize
bool GetPoint(AXValueRef valueRef, CGPoint *point) {
  if (!valueRef)
    return false;
  return AXValueGetValue(valueRef, (AXValueType)kAXValueCGPointType, point);
}

bool GetSize(AXValueRef valueRef, CGSize *size) {
  if (!valueRef)
    return false;
  return AXValueGetValue(valueRef, (AXValueType)kAXValueCGSizeType, size);
}

// Helper: Get string attribute from AXUIElement
NSString *GetStringAttribute(AXUIElementRef element, CFStringRef attribute) {
  CFTypeRef valueRef = NULL;
  if (AXUIElementCopyAttributeValue(element, attribute, &valueRef) ==
      kAXErrorSuccess) {
    if (valueRef && CFGetTypeID(valueRef) == CFStringGetTypeID()) {
      NSString *result = (__bridge_transfer NSString *)valueRef;
      return result;
    }
    if (valueRef)
      CFRelease(valueRef);
  }
  return nil;
}

// Helper: Traverse AX tree and collect elements
void TraverseElement(AXUIElementRef element, NSMutableArray *results, int depth,
                     int *elementId, CGFloat screenW, CGFloat screenH) {
  if (depth > 50 || *elementId >= 1000)
    return;

  @autoreleasepool {
    // Get role
    NSString *role = GetStringAttribute(element, kAXRoleAttribute);
    if (!role)
      return;

    // Target roles
    NSArray *targetRoles = @[
      @"AXButton", @"AXLink", @"AXTextField", @"AXTextArea", @"AXStaticText",
      @"AXMenuItem", @"AXPopUpButton", @"AXCheckBox", @"AXRadioButton",
      @"AXTab", @"AXImage", @"AXScrollArea", @"AXSlider", @"AXToolbar",
      @"AXGroup"
    ];

    if ([targetRoles containsObject:role]) {
      // Get label
      NSString *label = nil;
      NSArray *labelAttrs =
          @[ @"AXTitle", @"AXValue", @"AXDescription", @"AXLabel", @"AXHelp" ];
      for (NSString *attr in labelAttrs) {
        label = GetStringAttribute(element, (__bridge CFStringRef)attr);
        if (label && label.length > 0)
          break;
      }

      // Get position
      CFTypeRef posRef = NULL;
      CFTypeRef sizeRef = NULL;
      AXUIElementCopyAttributeValue(element, kAXPositionAttribute, &posRef);
      AXUIElementCopyAttributeValue(element, kAXSizeAttribute, &sizeRef);

      CGPoint pos = {0, 0};
      CGSize size = {0, 0};
      GetPoint((AXValueRef)posRef, &pos);
      GetSize((AXValueRef)sizeRef, &size);

      if (posRef)
        CFRelease(posRef);
      if (sizeRef)
        CFRelease(sizeRef);

      // Skip tiny elements
      if (size.width < 5 || size.height < 5)
        return;

      // Normalize bbox relative to entire screen
      CGFloat x = fmax(0.0, fmin(1.0, pos.x / screenW));
      CGFloat y = fmax(0.0, fmin(1.0, pos.y / screenH));
      CGFloat w = fmin(1.0, size.width / screenW);
      CGFloat h = fmin(1.0, size.height / screenH);

      // Map role to type
      NSString *type = @"text";
      if ([role isEqualToString:@"AXButton"] ||
          [role isEqualToString:@"AXPopUpButton"]) {
        type = @"button";
      } else if ([role isEqualToString:@"AXLink"]) {
        type = @"link";
      } else if ([role isEqualToString:@"AXTextField"] ||
                 [role isEqualToString:@"AXTextArea"]) {
        type = @"input";
      } else if ([role isEqualToString:@"AXMenuItem"] ||
                 [role isEqualToString:@"AXTab"]) {
        type = @"menu";
      } else if ([role isEqualToString:@"AXCheckBox"] ||
                 [role isEqualToString:@"AXRadioButton"]) {
        type = @"checkbox";
      } else if ([role isEqualToString:@"AXImage"]) {
        type = @"image";
      } else if ([role isEqualToString:@"AXScrollArea"]) {
        type = @"scroll";
      } else if ([role isEqualToString:@"AXSlider"]) {
        type = @"slider";
      } else if ([role isEqualToString:@"AXToolbar"]) {
        type = @"toolbar";
      } else if ([role isEqualToString:@"AXGroup"]) {
        type = @"group";
      }

      (*elementId)++;

      // Enhance label with role prefix for better LLM understanding
      // This helps distinguish between "Button: 7" vs "7" (static text/date)
      NSString *enhancedLabel = label ?: @"";
      if (label && label.length > 0) {
        // Only add prefix if label is very short/generic (likely ambiguous)
        if (label.length <= 3) {
          // Extract short role name for prefix
          NSString *rolePrefix = @"";
          if ([role isEqualToString:@"AXButton"]) {
            rolePrefix = @"Button";
          } else if ([role isEqualToString:@"AXStaticText"]) {
            rolePrefix = @"Text";
          } else if ([role isEqualToString:@"AXPopUpButton"]) {
            rolePrefix = @"Menu";
          } else if ([role isEqualToString:@"AXMenuItem"]) {
            rolePrefix = @"Item";
          } else if ([role isEqualToString:@"AXTab"]) {
            rolePrefix = @"Tab";
          }

          if (rolePrefix.length > 0) {
            enhancedLabel =
                [NSString stringWithFormat:@"%@: %@", rolePrefix, label];
          }
        }
      }

      NSDictionary *item = @{
        @"id" : [NSString stringWithFormat:@"%d", *elementId],
        @"type" : type,
        @"label" : enhancedLabel,
        @"bbox" : @{@"x" : @(x), @"y" : @(y), @"w" : @(w), @"h" : @(h)},
        @"confidence" : @1.0
      };

      [results addObject:item];
    }

    // Traverse children
    CFTypeRef childrenRef = NULL;
    if (AXUIElementCopyAttributeValue(element, kAXChildrenAttribute,
                                      &childrenRef) == kAXErrorSuccess) {
      if (childrenRef && CFGetTypeID(childrenRef) == CFArrayGetTypeID()) {
        NSArray *children = (__bridge_transfer NSArray *)childrenRef;
        for (id child in children) {
          if (*elementId >= 1000)
            break;
          TraverseElement((__bridge AXUIElementRef)child, results, depth + 1,
                          elementId, screenW, screenH);
        }
      } else if (childrenRef) {
        CFRelease(childrenRef);
      }
    }
  }
}

// Main extraction function
napi_value ExtractAXTree(napi_env env, napi_callback_info info) {
  napi_status status;

  // Get arguments (optional: appName)
  size_t argc = 1;
  napi_value args[1];
  status = napi_get_cb_info(env, info, &argc, args, NULL, NULL);

  NSString *targetAppName = nil;
  if (argc > 0) {
    size_t str_size;
    napi_get_value_string_utf8(env, args[0], NULL, 0, &str_size);
    char *buf = (char *)malloc(str_size + 1);
    napi_get_value_string_utf8(env, args[0], buf, str_size + 1, &str_size);
    targetAppName = [NSString stringWithUTF8String:buf];
    free(buf);

    // Normalize app names (Spanish -> English for macOS)
    NSDictionary *appMappings = @{
      @"Calculadora" : @"Calculator",
      @"Calendario" : @"Calendar",
      @"Contactos" : @"Contacts",
      @"Notas" : @"Notes",
      @"Música" : @"Music",
      @"Fotos" : @"Photos",
      @"Mapas" : @"Maps",
      @"Recordatorios" : @"Reminders",
      @"Mail" : @"Mail",
      @"Mensajes" : @"Messages",
      @"FaceTime" : @"FaceTime",
      @"Safari" : @"Safari",
      @"Chrome" : @"Google Chrome",
      @"Finder" : @"Finder"
    };

    NSString *normalized = appMappings[targetAppName];
    if (normalized) {
      targetAppName = normalized;
    }
  }

  @autoreleasepool {
    NSMutableDictionary *result = [NSMutableDictionary dictionary];
    result[@"snapshot"] = [NSMutableArray array];

    // Get target application
    NSRunningApplication *targetApp = nil;

    // If targetAppName is specified, find that specific app
    if (targetAppName && targetAppName.length > 0) {
      NSArray *runningApps =
          [[NSWorkspace sharedWorkspace] runningApplications];
      for (NSRunningApplication *app in runningApps) {
        NSString *appLocalizedName = [app localizedName];
        if ([appLocalizedName isEqualToString:targetAppName]) {
          targetApp = app;
          break;
        }
      }

      // If not found by localized name, try bundle identifier match
      if (!targetApp) {
        for (NSRunningApplication *app in runningApps) {
          NSString *bundleId = [app bundleIdentifier];
          if (bundleId &&
              [bundleId.lastPathComponent isEqualToString:targetAppName]) {
            targetApp = app;
            break;
          }
        }
      }
    }

    // Fallback to frontmost if no target specified or not found
    if (!targetApp) {
      targetApp = [[NSWorkspace sharedWorkspace] frontmostApplication];
    }

    pid_t pid = [targetApp processIdentifier];
    NSString *appName = [targetApp localizedName];

    result[@"app"] = appName;

    // Create AXUIElement for app
    AXUIElementRef appElement = AXUIElementCreateApplication(pid);
    if (!appElement) {
      result[@"error"] = @"Failed to create AXUIElement";
      result[@"diagnostic"] = @"NO_APP_ELEMENT";

      // Convert to JS object
      napi_value js_result;
      napi_create_object(env, &js_result);
      // ... conversion code
      return js_result;
    }

    // ── Window Selection Strategy ──────────────────────────────────────────
    // Priority:
    //   1. AXFocusedWindow  (reflects what the user is interacting with NOW)
    //   2. Modal/Sheet detection: if AXWindows has >1 entry AND a smaller
    //      window exists (sheet/modal), prefer it over the main window.
    //   3. AXMainWindow  (fallback to main window)
    //   4. AXWindows[0]  (last resort)
    //
    // This keeps the graph single-window (no merging) so the navigable map
    // remains clean: each (appName, windowTitle) is a distinct node/room.
    // ──────────────────────────────────────────────────────────────────────

    AXUIElementRef window = NULL;
    CFTypeRef windowRef = NULL;

    // Step 1: Collect all windows for modal detection
    NSArray *allWindows = nil;
    {
      CFTypeRef windowsRef = NULL;
      AXError axError = AXUIElementCopyAttributeValue(
          appElement, kAXWindowsAttribute, &windowsRef);

      if (axError == kAXErrorCannotComplete || axError == kAXErrorAPIDisabled) {
        result[@"error"] = @"Permission denied - Accessibility access required";
        result[@"diagnostic"] = @"PERMISSION_DENIED";
        CFRelease(appElement);

        napi_value js_result;
        napi_create_object(env, &js_result);
        napi_value js_error, js_diagnostic, js_snapshot;
        napi_create_string_utf8(
            env, "Permission denied - Accessibility access required",
            NAPI_AUTO_LENGTH, &js_error);
        napi_create_string_utf8(env, "PERMISSION_DENIED", NAPI_AUTO_LENGTH,
                                &js_diagnostic);
        napi_create_array(env, &js_snapshot);
        napi_set_named_property(env, js_result, "error", js_error);
        napi_set_named_property(env, js_result, "diagnostic", js_diagnostic);
        napi_set_named_property(env, js_result, "snapshot", js_snapshot);
        return js_result;
      }

      if (axError == kAXErrorSuccess && windowsRef &&
          CFGetTypeID(windowsRef) == CFArrayGetTypeID()) {
        allWindows = (__bridge_transfer NSArray *)windowsRef;
      } else if (windowsRef) {
        CFRelease(windowsRef);
      }
    }

    // Helper block: get CGSize of an AX window element
    CGSize (^getWindowSize)(id) = ^CGSize(id winObj) {
      AXUIElementRef winRef = (__bridge AXUIElementRef)winObj;
      CFTypeRef sRef = NULL;
      CGSize s = {0, 0};
      if (AXUIElementCopyAttributeValue(winRef, kAXSizeAttribute, &sRef) ==
              kAXErrorSuccess &&
          sRef) {
        AXValueGetValue((AXValueRef)sRef, (AXValueType)kAXValueCGSizeType, &s);
        CFRelease(sRef);
      }
      return s;
    };

    // Step 2: Try AXFocusedWindow
    if (AXUIElementCopyAttributeValue(appElement, kAXFocusedWindowAttribute,
                                      &windowRef) == kAXErrorSuccess &&
        windowRef) {
      window = (AXUIElementRef)CFRetain(windowRef);
      CFRelease(windowRef);
    }

    // Step 3: Modal/Sheet override
    // If there are multiple windows, check whether any of them is a modal/sheet
    // (smaller area than the focused/main window). Sheets in SwiftUI appear as
    // additional entries and are always narrower+shorter than the parent.
    // We prefer the smallest window that is NOT the direct same reference as
    // the already-selected focused window, because that is the active dialog.
    if (allWindows && allWindows.count > 1) {
      CGSize focusedSize =
          window ? getWindowSize((__bridge id)window) : CGSizeMake(0, 0);
      double focusedArea = focusedSize.width * focusedSize.height;

      AXUIElementRef modalCandidate = NULL;
      double smallestArea = focusedArea > 0 ? focusedArea : DBL_MAX;

      for (id winObj in allWindows) {
        AXUIElementRef candidate = (__bridge AXUIElementRef)winObj;
        // Skip if same reference as already-selected window
        if (window && CFEqual(candidate, window))
          continue;

        CGSize candidateSize = getWindowSize(winObj);
        double candidateArea = candidateSize.width * candidateSize.height;

        // Must be non-trivial (at least 100x100) and SMALLER than current
        if (candidateArea > 10000 && candidateArea < smallestArea) {
          smallestArea = candidateArea;
          modalCandidate = candidate;
        }
      }

      if (modalCandidate) {
        // Release old window ref and adopt the modal/sheet
        if (window)
          CFRelease(window);
        window = (AXUIElementRef)CFRetain(modalCandidate);
      }
    }

    // Step 4: Fallback to AXMainWindow
    if (!window) {
      if (AXUIElementCopyAttributeValue(appElement, kAXMainWindowAttribute,
                                        &windowRef) == kAXErrorSuccess &&
          windowRef) {
        window = (AXUIElementRef)CFRetain(windowRef);
        CFRelease(windowRef);
      }
    }

    // Step 5: Fallback to first window in AXWindows
    if (!window && allWindows && allWindows.count > 0) {
      window = (AXUIElementRef)CFRetain((__bridge CFTypeRef)allWindows[0]);
    }

    if (!window) {
      result[@"error"] = @"No window found";
      result[@"diagnostic"] = @"NO_WINDOW";
      CFRelease(appElement);

      // Convert to JS
      napi_value js_result;
      napi_create_object(env, &js_result);

      napi_value js_error, js_diagnostic, js_snapshot;
      napi_create_string_utf8(env, "No window found", NAPI_AUTO_LENGTH,
                              &js_error);
      napi_create_string_utf8(env, "NO_WINDOW", NAPI_AUTO_LENGTH,
                              &js_diagnostic);
      napi_create_array(env, &js_snapshot);

      napi_set_named_property(env, js_result, "error", js_error);
      napi_set_named_property(env, js_result, "diagnostic", js_diagnostic);
      napi_set_named_property(env, js_result, "snapshot", js_snapshot);

      return js_result;
    }

    // Get window title
    NSString *windowTitle = GetStringAttribute(window, kAXTitleAttribute);
    result[@"window"] = windowTitle ?: @"Untitled";

    // Get window frame
    CFTypeRef posRef = NULL, sizeRef = NULL;
    AXUIElementCopyAttributeValue(window, kAXPositionAttribute, &posRef);
    AXUIElementCopyAttributeValue(window, kAXSizeAttribute, &sizeRef);

    CGPoint winPos = {0, 0};
    CGSize winSize = {1920, 1080};
    GetPoint((AXValueRef)posRef, &winPos);
    GetSize((AXValueRef)sizeRef, &winSize);

    if (posRef)
      CFRelease(posRef);
    if (sizeRef)
      CFRelease(sizeRef);

    // Get primary screen size for normalization
    CGSize screenSize = [[NSScreen mainScreen] frame].size;

    // Traverse tree
    int elementId = 0;
    NSMutableArray *snapshot = [NSMutableArray array];
    TraverseElement(window, snapshot, 0, &elementId, screenSize.width,
                    screenSize.height);

    result[@"snapshot"] = snapshot;

    CFRelease(window);
    CFRelease(appElement);

    // Convert NSMutableDictionary to napi_value
    napi_value js_result;
    napi_create_object(env, &js_result);

    // Add app name
    napi_value js_app;
    napi_create_string_utf8(env, [appName UTF8String], NAPI_AUTO_LENGTH,
                            &js_app);
    napi_set_named_property(env, js_result, "app", js_app);

    // Add window title
    napi_value js_window;
    napi_create_string_utf8(env, [[result[@"window"] description] UTF8String],
                            NAPI_AUTO_LENGTH, &js_window);
    napi_set_named_property(env, js_result, "window", js_window);

    // Add snapshot array
    napi_value js_snapshot;
    napi_create_array_with_length(env, [snapshot count], &js_snapshot);

    for (NSUInteger i = 0; i < [snapshot count]; i++) {
      NSDictionary *item = snapshot[i];
      napi_value js_item;
      napi_create_object(env, &js_item);

      // id
      napi_value js_id;
      napi_create_string_utf8(env, [[item[@"id"] description] UTF8String],
                              NAPI_AUTO_LENGTH, &js_id);
      napi_set_named_property(env, js_item, "id", js_id);

      // type
      napi_value js_type;
      napi_create_string_utf8(env, [[item[@"type"] description] UTF8String],
                              NAPI_AUTO_LENGTH, &js_type);
      napi_set_named_property(env, js_item, "type", js_type);

      // label
      napi_value js_label;
      napi_create_string_utf8(env, [[item[@"label"] description] UTF8String],
                              NAPI_AUTO_LENGTH, &js_label);
      napi_set_named_property(env, js_item, "label", js_label);

      // bbox
      NSDictionary *bbox = item[@"bbox"];
      napi_value js_bbox;
      napi_create_object(env, &js_bbox);

      napi_value js_x, js_y, js_w, js_h;
      napi_create_double(env, [bbox[@"x"] doubleValue], &js_x);
      napi_create_double(env, [bbox[@"y"] doubleValue], &js_y);
      napi_create_double(env, [bbox[@"w"] doubleValue], &js_w);
      napi_create_double(env, [bbox[@"h"] doubleValue], &js_h);

      napi_set_named_property(env, js_bbox, "x", js_x);
      napi_set_named_property(env, js_bbox, "y", js_y);
      napi_set_named_property(env, js_bbox, "w", js_w);
      napi_set_named_property(env, js_bbox, "h", js_h);

      napi_set_named_property(env, js_item, "bbox", js_bbox);

      // confidence
      napi_value js_confidence;
      napi_create_double(env, [item[@"confidence"] doubleValue],
                         &js_confidence);
      napi_set_named_property(env, js_item, "confidence", js_confidence);

      napi_set_element(env, js_snapshot, i, js_item);
    }

    napi_set_named_property(env, js_result, "snapshot", js_snapshot);

    return js_result;
  }
}

// Get current mouse buttons state (mask)
napi_value GetMouseButtons(napi_env env, napi_callback_info info) {
  NSUInteger buttons = [NSEvent pressedMouseButtons];
  napi_value js_buttons;
  napi_create_uint32(env, (uint32_t)buttons, &js_buttons);
  return js_buttons;
}

// Module initialization
napi_value Init(napi_env env, napi_value exports) {
  napi_status status;
  napi_value fn_extract, fn_buttons;

  status = napi_create_function(env, NULL, 0, ExtractAXTree, NULL, &fn_extract);
  if (status == napi_ok) {
    napi_set_named_property(env, exports, "extract", fn_extract);
  }

  status =
      napi_create_function(env, NULL, 0, GetMouseButtons, NULL, &fn_buttons);
  if (status == napi_ok) {
    napi_set_named_property(env, exports, "getMouseButtons", fn_buttons);
  }

  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
