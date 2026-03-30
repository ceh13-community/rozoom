/*
 * gcloud-wrapper.c - Tauri sidecar wrapper for Google Cloud SDK.
 *
 * Compiled binary is placed as  binaries/gcloud-cli  (+ Tauri triple suffix).
 * At runtime it resolves the google-cloud-sdk directory relative to its own
 * location and exec's  google-cloud-sdk/bin/gcloud  with all original args.
 *
 * Build:
 *   Linux   : gcc -O2 -o gcloud-cli gcloud-wrapper.c
 *   macOS   : clang -O2 -o gcloud-cli gcloud-wrapper.c
 *   Windows : cl /O2 /Fe:gcloud-cli.exe gcloud-wrapper.c
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#  include <windows.h>
#  include <process.h>
#  define PATH_SEP '\\'
#else
#  include <unistd.h>
#  include <libgen.h>
#  include <sys/stat.h>
#  include <limits.h>
#  define PATH_SEP '/'
#endif

#ifndef PATH_MAX
#  define PATH_MAX 4096
#endif

/* Candidate relative paths from the wrapper binary to google-cloud-sdk */
static const char *CANDIDATES[] = {
    "/../binaries/google-cloud-sdk",        /* dev layout: binaries/<wrapper> */
    "/../../binaries/google-cloud-sdk",      /* Tauri bundled sidecar (Linux) */
    "/../Resources/binaries/google-cloud-sdk", /* Tauri bundled (macOS .app)  */
    NULL,
};

static int dir_exists(const char *p) {
#ifdef _WIN32
    DWORD attr = GetFileAttributesA(p);
    return (attr != INVALID_FILE_ATTRIBUTES && (attr & FILE_ATTRIBUTE_DIRECTORY));
#else
    struct stat st;
    return stat(p, &st) == 0 && S_ISDIR(st.st_mode);
#endif
}

static int get_exe_dir(char *buf, size_t len) {
#ifdef _WIN32
    DWORD n = GetModuleFileNameA(NULL, buf, (DWORD)len);
    if (n == 0 || n >= len) return -1;
    char *sep = strrchr(buf, '\\');
    if (sep) *sep = '\0';
    return 0;
#elif defined(__APPLE__)
    uint32_t sz = (uint32_t)len;
    extern int _NSGetExecutablePath(char *, uint32_t *);
    char raw[PATH_MAX];
    if (_NSGetExecutablePath(raw, &sz) != 0) return -1;
    if (!realpath(raw, buf)) return -1;
    char *sep = strrchr(buf, '/');
    if (sep) *sep = '\0';
    return 0;
#else
    ssize_t n = readlink("/proc/self/exe", buf, len - 1);
    if (n <= 0) return -1;
    buf[n] = '\0';
    char *sep = strrchr(buf, '/');
    if (sep) *sep = '\0';
    return 0;
#endif
}

int main(int argc, char **argv) {
    char exe_dir[PATH_MAX];
    if (get_exe_dir(exe_dir, sizeof(exe_dir)) != 0) {
        fprintf(stderr, "gcloud-cli: cannot resolve own path\n");
        return 1;
    }

    char sdk_dir[PATH_MAX];
    char gcloud[PATH_MAX];
    const char **cand;

    for (cand = CANDIDATES; *cand; cand++) {
        snprintf(sdk_dir, sizeof(sdk_dir), "%s%s", exe_dir, *cand);
        if (dir_exists(sdk_dir)) {
#ifdef _WIN32
            snprintf(gcloud, sizeof(gcloud), "%s\\bin\\gcloud.cmd", sdk_dir);
#else
            snprintf(gcloud, sizeof(gcloud), "%s/bin/gcloud", sdk_dir);
#endif
            /* Set CLOUDSDK_ROOT_DIR so gcloud doesn't try to auto-detect */
            char env_buf[PATH_MAX + 32];
            snprintf(env_buf, sizeof(env_buf), "CLOUDSDK_ROOT_DIR=%s", sdk_dir);
#ifdef _WIN32
            _putenv(env_buf);
#else
            putenv(env_buf);
#endif

            argv[0] = gcloud;
#ifdef _WIN32
            return _spawnv(_P_WAIT, gcloud, (const char *const *)argv);
#else
            execv(gcloud, argv);
            /* execv only returns on error */
            perror("gcloud-cli: execv");
            return 1;
#endif
        }
    }

    fprintf(stderr, "gcloud-cli: google-cloud-sdk not found near %s\n", exe_dir);
    return 1;
}
