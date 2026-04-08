package com.iu.launcher;

import android.annotation.SuppressLint;
import android.app.role.RoleManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.GestureDetector;
import android.view.HapticFeedbackConstants;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;

public class MainActivity extends AppCompatActivity {
    private static final int LEVEL_COUNT = 2;
    private static final String[] LEVEL_URLS = new String[] {
        "file:///android_asset/launcher/home.html",
        "file:///android_asset/launcher/chat.html"
    };

    private View rootContainer;
    private View lockscreenLayer;
    private View launcherSetupCard;
    private WebView webView;
    private WebView bubbleWebView;
    private Button launcherSetupAction;
    private Button launcherSetupDismiss;
    private Button lockscreenUnlockButton;
    private Button lockscreenLauncherButton;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private Insets latestInsets = Insets.NONE;
    private WindowInsetsControllerCompat windowInsetsController;
    private int currentLevel = 0;
    private boolean lockscreenVisible = true;
    private float bubbleDownRawX = 0f;
    private float bubbleDownRawY = 0f;
    private int bubbleStartTopMargin = 0;
    private int bubbleStartRightMargin = 0;
    private boolean bubbleDragging = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        setContentView(R.layout.activity_main);

        rootContainer = findViewById(R.id.root_container);
        lockscreenLayer = findViewById(R.id.lockscreen_layer);
        launcherSetupCard = findViewById(R.id.launcher_setup_card);
        webView = findViewById(R.id.launcher_webview);
        bubbleWebView = findViewById(R.id.face_bubble_webview);
        launcherSetupAction = findViewById(R.id.launcher_setup_action);
        launcherSetupDismiss = findViewById(R.id.launcher_setup_dismiss);
        lockscreenUnlockButton = findViewById(R.id.lockscreen_unlock_button);
        lockscreenLauncherButton = findViewById(R.id.lockscreen_launcher_button);

        configureWindow();
        configureWebView(webView, false);
        configureWebView(bubbleWebView, true);
        bindInsets();
        bindLauncherSetup();
        bindLockscreen();
        bindBubbleDrag();

        bubbleWebView.loadUrl("file:///android_asset/launcher/face-bubble.html");
        loadLevel(0, false);
        showLockscreenLayer(false);
    }

    @Override
    protected void onResume() {
        super.onResume();
        updateLauncherSetupVisibility();
    }

    private void configureWindow() {
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        windowInsetsController = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (windowInsetsController != null) {
            windowInsetsController.setAppearanceLightStatusBars(false);
            windowInsetsController.setAppearanceLightNavigationBars(false);
            windowInsetsController.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView(WebView target, boolean transparent) {
        final WebSettings settings = target.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setDatabaseEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);

        if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK)) {
            WebSettingsCompat.setForceDark(settings, WebSettingsCompat.FORCE_DARK_OFF);
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        target.setBackgroundColor(transparent ? Color.TRANSPARENT : Color.BLACK);
        target.addJavascriptInterface(new HostBridge(), "AndroidHost");
        target.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                applyInsetsToWebContent(view);
                if (view == webView) {
                    injectLevelContext();
                } else {
                    injectBubbleState();
                }
            }
        });
        target.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
                return super.onConsoleMessage(consoleMessage);
            }
        });
    }

    private void bindInsets() {
        ViewCompat.setOnApplyWindowInsetsListener(rootContainer, (view, windowInsets) -> {
            latestInsets = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );

            final ViewGroup.MarginLayoutParams bubbleLayout =
                (ViewGroup.MarginLayoutParams) bubbleWebView.getLayoutParams();
            if (!bubbleDragging) {
                bubbleLayout.topMargin = latestInsets.top + dp(18);
                bubbleLayout.rightMargin = latestInsets.right + dp(16);
                bubbleWebView.setLayoutParams(bubbleLayout);
            }

            final ViewGroup.MarginLayoutParams setupLayout =
                (ViewGroup.MarginLayoutParams) launcherSetupCard.getLayoutParams();
            setupLayout.bottomMargin = latestInsets.bottom + dp(16);
            launcherSetupCard.setLayoutParams(setupLayout);

            final ViewGroup.MarginLayoutParams lockButtonLayout =
                (ViewGroup.MarginLayoutParams) lockscreenUnlockButton.getLayoutParams();
            lockscreenUnlockButton.setLayoutParams(lockButtonLayout);

            applyInsetsToWebContent(webView);
            applyInsetsToWebContent(bubbleWebView);
            return windowInsets;
        });
    }

    private void bindLauncherSetup() {
        launcherSetupAction.setOnClickListener((view) -> requestLauncherRole());
        launcherSetupDismiss.setOnClickListener((view) -> launcherSetupCard.setVisibility(View.GONE));
    }

    @SuppressLint("ClickableViewAccessibility")
    private void bindLockscreen() {
        lockscreenUnlockButton.setOnClickListener((view) -> unlockToLevel(0));
        lockscreenLauncherButton.setOnClickListener((view) -> requestLauncherRole());

        final GestureDetector gestureDetector = new GestureDetector(this, new GestureDetector.SimpleOnGestureListener() {
            @Override
            public boolean onDown(@NonNull MotionEvent e) {
                return true;
            }

            @Override
            public boolean onFling(MotionEvent e1, MotionEvent e2, float velocityX, float velocityY) {
                if (e1 == null || e2 == null) {
                    return false;
                }
                final float deltaY = e2.getY() - e1.getY();
                if (deltaY < -dp(72)) {
                    unlockToLevel(0);
                    return true;
                }
                return false;
            }
        });

        lockscreenLayer.setOnTouchListener((view, event) -> {
            gestureDetector.onTouchEvent(event);
            return false;
        });
    }

    @SuppressLint("ClickableViewAccessibility")
    private void bindBubbleDrag() {
        bubbleWebView.setOnTouchListener((view, event) -> {
            final ViewGroup.MarginLayoutParams layoutParams =
                (ViewGroup.MarginLayoutParams) bubbleWebView.getLayoutParams();

            switch (event.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    bubbleDownRawX = event.getRawX();
                    bubbleDownRawY = event.getRawY();
                    bubbleStartTopMargin = layoutParams.topMargin;
                    bubbleStartRightMargin = layoutParams.rightMargin;
                    bubbleDragging = false;
                    return false;
                case MotionEvent.ACTION_MOVE:
                    final float deltaX = event.getRawX() - bubbleDownRawX;
                    final float deltaY = event.getRawY() - bubbleDownRawY;
                    if (Math.abs(deltaX) > dp(6) || Math.abs(deltaY) > dp(6)) {
                        bubbleDragging = true;
                    }
                    if (!bubbleDragging) {
                        return false;
                    }

                    layoutParams.topMargin = clamp(
                        Math.round(bubbleStartTopMargin + deltaY),
                        latestInsets.top + dp(8),
                        Math.max(latestInsets.top + dp(8), rootContainer.getHeight() - bubbleWebView.getHeight() - latestInsets.bottom - dp(8))
                    );
                    layoutParams.rightMargin = clamp(
                        Math.round(bubbleStartRightMargin - deltaX),
                        latestInsets.right + dp(8),
                        Math.max(latestInsets.right + dp(8), rootContainer.getWidth() - bubbleWebView.getWidth() - latestInsets.left - dp(8))
                    );
                    bubbleWebView.setLayoutParams(layoutParams);
                    return true;
                case MotionEvent.ACTION_UP:
                    if (!bubbleDragging) {
                        toggleBubbleTarget();
                    }
                    bubbleDragging = false;
                    return true;
                case MotionEvent.ACTION_CANCEL:
                    bubbleDragging = false;
                    return false;
                default:
                    return false;
            }
        });
    }

    private void toggleBubbleTarget() {
        if (lockscreenVisible) {
            unlockToLevel(Math.min(1, LEVEL_COUNT - 1));
            return;
        }
        loadLevel(currentLevel == 0 ? 1 : 0, true);
    }

    private void loadLevel(int nextLevel, boolean withHaptic) {
        if (nextLevel < 0 || nextLevel >= LEVEL_COUNT || (nextLevel == currentLevel && webView.getUrl() != null)) {
            return;
        }

        currentLevel = nextLevel;
        if (withHaptic) {
            webView.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK);
        }
        webView.loadUrl(LEVEL_URLS[currentLevel]);
        applySystemUiProfile();
        syncBubbleVisibility();
    }

    private void showLockscreenLayer(boolean animated) {
        lockscreenVisible = true;
        lockscreenLayer.setVisibility(View.VISIBLE);
        lockscreenLayer.setAlpha(1f);
        lockscreenLayer.setTranslationY(0f);
        syncBubbleVisibility();
        applySystemUiProfile();

        if (animated) {
            lockscreenLayer.setAlpha(0f);
            lockscreenLayer.animate().alpha(1f).setDuration(180).start();
        }
    }

    private void unlockToLevel(int targetLevel) {
        if (targetLevel >= 0 && targetLevel < LEVEL_COUNT && targetLevel != currentLevel) {
            currentLevel = targetLevel;
            webView.loadUrl(LEVEL_URLS[currentLevel]);
            injectLevelContext();
        }

        lockscreenVisible = false;
        lockscreenLayer.animate()
            .translationY(-Math.max(rootContainer.getHeight(), dp(640)))
            .alpha(0f)
            .setDuration(280)
            .withEndAction(() -> {
                lockscreenLayer.setVisibility(View.GONE);
                lockscreenLayer.setTranslationY(0f);
                lockscreenLayer.setAlpha(1f);
                syncBubbleVisibility();
                applySystemUiProfile();
            })
            .start();
    }

    private void syncBubbleVisibility() {
        final boolean shouldShowBubble = !lockscreenVisible && currentLevel != 0;

        if (!shouldShowBubble) {
            bubbleWebView.animate().alpha(0f).setDuration(120).withEndAction(() -> bubbleWebView.setVisibility(View.GONE)).start();
            injectBubbleState();
            return;
        }

        bubbleWebView.setVisibility(View.VISIBLE);
        bubbleWebView.animate().alpha(1f).setDuration(160).start();
        injectBubbleState();
    }

    private void applyInsetsToWebContent(WebView target) {
        if (target == null) return;
        final String js = String.format(
            "(() => {" +
                "const root = document.documentElement;" +
                "root.style.setProperty('--safe-top', '%dpx');" +
                "root.style.setProperty('--safe-bottom', '%dpx');" +
                "root.style.setProperty('--safe-left', '%dpx');" +
                "root.style.setProperty('--safe-right', '%dpx');" +
                "window.dispatchEvent(new CustomEvent('iu-safe-area', { detail: { top:%d, bottom:%d, left:%d, right:%d } }));" +
            "})()",
            latestInsets.top,
            latestInsets.bottom,
            latestInsets.left,
            latestInsets.right,
            latestInsets.top,
            latestInsets.bottom,
            latestInsets.left,
            latestInsets.right
        );
        target.evaluateJavascript(js, null);
    }

    private void injectLevelContext() {
        final String js = String.format(
            "(() => {" +
                "window.dispatchEvent(new CustomEvent('iu-level-change', { detail: { level:%d } }));" +
            "})()",
            currentLevel
        );
        webView.evaluateJavascript(js, null);
        injectBubbleState();
    }

    private void injectBubbleState() {
        final String js = String.format(
            "(() => {" +
                "window.dispatchEvent(new CustomEvent('iu-bubble-state', { detail: { level:%d, visible:%s } }));" +
            "})()",
            currentLevel,
            (!lockscreenVisible && currentLevel != 0) ? "true" : "false"
        );
        bubbleWebView.evaluateJavascript(js, null);
    }

    private void applySystemUiProfile() {
        if (windowInsetsController == null) return;
        if (lockscreenVisible) {
            windowInsetsController.hide(WindowInsetsCompat.Type.systemBars());
        } else {
            windowInsetsController.show(WindowInsetsCompat.Type.systemBars());
        }
    }

    private void updateLauncherSetupVisibility() {
        launcherSetupCard.setVisibility(isLauncherDefault() ? View.GONE : View.VISIBLE);
    }

    private boolean isLauncherDefault() {
        final Intent intent = new Intent(Intent.ACTION_MAIN);
        intent.addCategory(Intent.CATEGORY_HOME);
        final android.content.pm.ResolveInfo resolveInfo = getPackageManager().resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY);
        if (resolveInfo == null || resolveInfo.activityInfo == null) {
            return false;
        }
        return getPackageName().equals(resolveInfo.activityInfo.packageName);
    }

    private void requestLauncherRole() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                final RoleManager roleManager = getSystemService(RoleManager.class);
                if (roleManager != null && roleManager.isRoleAvailable(RoleManager.ROLE_HOME) && !roleManager.isRoleHeld(RoleManager.ROLE_HOME)) {
                    startActivity(roleManager.createRequestRoleIntent(RoleManager.ROLE_HOME));
                    return;
                }
            }
        } catch (Exception ignored) {
            // Fall through to settings.
        }

        try {
            final Intent intent = new Intent(Settings.ACTION_HOME_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (Exception ignored) {
            try {
                final Intent fallback = new Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS);
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(fallback);
            } catch (Exception ignoredAgain) {
                final Intent chooserIntent = new Intent(Intent.ACTION_MAIN);
                chooserIntent.addCategory(Intent.CATEGORY_HOME);
                chooserIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(chooserIntent);
            }
        }
    }

    private int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }

    private int dp(int value) {
        return Math.round(getResources().getDisplayMetrics().density * value);
    }

    @Override
    public void onBackPressed() {
        if (!lockscreenVisible && currentLevel > 0) {
            loadLevel(0, true);
            return;
        }
        if (!lockscreenVisible && currentLevel == 0) {
            showLockscreenLayer(true);
            return;
        }
        super.onBackPressed();
    }

    public final class HostBridge {
        @JavascriptInterface
        public void switchLevel(int level) {
            mainHandler.post(() -> {
                if (level < 0 || level >= LEVEL_COUNT) return;
                if (lockscreenVisible) {
                    unlockToLevel(level);
                    return;
                }
                loadLevel(level, true);
            });
        }

        @JavascriptInterface
        public void requestLauncherRole() {
            mainHandler.post(MainActivity.this::requestLauncherRole);
        }

        @JavascriptInterface
        public boolean isLauncherDefault() {
            return MainActivity.this.isLauncherDefault();
        }

        @JavascriptInterface
        public void showLockscreen() {
            mainHandler.post(() -> showLockscreenLayer(true));
        }

        @JavascriptInterface
        public void vibrateLight() {
            mainHandler.post(() -> webView.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK));
        }

        @JavascriptInterface
        public int getCurrentLevel() {
            return currentLevel;
        }

        @JavascriptInterface
        public void dismissLauncherSetup() {
            mainHandler.post(() -> launcherSetupCard.setVisibility(View.GONE));
        }

        @JavascriptInterface
        public void log(String message) {
            // Keep simple for fast iteration.
        }
    }
}
