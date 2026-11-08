#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <windows.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>

static int check_input(const wchar_t *path)
{
    const char expected[] = "trial input";
    char data[sizeof(expected)];
    DWORD count;
    HANDLE file = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (file == INVALID_HANDLE_VALUE) return 0;
    BOOL read = ReadFile(file, data, sizeof(data), &count, NULL);
    CloseHandle(file);
    return read && count == sizeof(expected) - 1 && memcmp(data, expected, count) == 0;
}

static int denies_private_file(const wchar_t *path)
{
    HANDLE file = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (file == INVALID_HANDLE_VALUE) return GetLastError() == ERROR_ACCESS_DENIED;
    CloseHandle(file);
    return 0;
}

static int check_scratch(const wchar_t *temporary, const wchar_t *written)
{
    const char output[] = "trial output";
    DWORD count;
    HANDLE file = CreateFileW(temporary, GENERIC_WRITE, 0, NULL, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, NULL);
    if (file == INVALID_HANDLE_VALUE) return 0;
    BOOL wrote = WriteFile(file, output, sizeof(output) - 1, &count, NULL);
    CloseHandle(file);
    return wrote && count == sizeof(output) - 1 && MoveFileW(temporary, written);
}

static int check_loopback(unsigned short port)
{
    WSADATA data;
    int error = WSAStartup(MAKEWORD(2, 2), &data);
    if (error != 0) return 100000 + error;
    SOCKET connection = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    int verdict;
    if (connection != INVALID_SOCKET)
    {
        struct sockaddr_in address = {0};
        address.sin_family = AF_INET;
        address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        address.sin_port = htons(port);
        if (connect(connection, (const struct sockaddr *)&address, sizeof(address)) == SOCKET_ERROR) {
            error = WSAGetLastError();
            verdict = error == WSAEACCES || error == WSAECONNREFUSED ? 0 : 300000 + error;
        } else verdict = 12;
        closesocket(connection);
    }
    else {
        error = WSAGetLastError();
        verdict = error == WSAEACCES ? 0 : 200000 + error;
    }
    WSACleanup();
    return verdict;
}

static int denies_child(const wchar_t *executable)
{
    STARTUPINFOW startup = {0};
    PROCESS_INFORMATION child = {0};
    wchar_t command[] = L"probe noop";
    startup.cb = sizeof(startup);
    if (!CreateProcessW(executable, command, NULL, NULL, FALSE, CREATE_SUSPENDED | DETACHED_PROCESS,
        NULL, NULL, &startup, &child))
    {
        DWORD error = GetLastError();
        return error == ERROR_ACCESS_DENIED || error == ERROR_CHILD_PROCESS_BLOCKED;
    }
    TerminateProcess(child.hProcess, 1);
    CloseHandle(child.hThread);
    CloseHandle(child.hProcess);
    return 0;
}

int wmain(int argc, wchar_t **argv)
{
    if (argc == 2 && wcscmp(argv[1], L"hang") == 0) Sleep(INFINITE);
    if (argc == 2 && wcscmp(argv[1], L"noop") == 0) return 0;
    if (argc != 7 || wcscmp(argv[1], L"guest") != 0) return 1;
    wchar_t *end;
    unsigned long port = wcstoul(argv[6], &end, 10);
    if (*end != L'\0' || port == 0 || port > 65535) return 1;
    if (!check_input(argv[2])) return 10;
    if (!denies_private_file(argv[3])) return 11;
    int network = check_loopback((unsigned short)port);
    int winsockUnavailable = network == 100000 + WSASYSCALLFAILURE;
    if (network != 0 && !winsockUnavailable) return network;
    if (!denies_child(argv[0])) return 13;
    if (!check_scratch(argv[4], argv[5])) return 14;
    const char *output = winsockUnavailable ? "probe output; Winsock initialization failed (10107)" : "probe output";
    DWORD length = (DWORD)strlen(output);
    DWORD written;
    return WriteFile(GetStdHandle(STD_OUTPUT_HANDLE), output, length, &written, NULL)
        && written == length ? 0 : 15;
}
