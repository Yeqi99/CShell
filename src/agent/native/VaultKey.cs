using System;
using System.IO;
using System.Security.Cryptography;

// Internal pipe protocol for the CAgent vault's 32-byte AES key.
internal static class VaultKey {
    public static int Main(string[] args) {
        if (args.Length != 1 || (args[0] != "seal" && args[0] != "open")) return 2;
        byte[] input = new byte[4097], output = null, value = null;
        try {
            var stream = Console.OpenStandardInput();
            int length = 0, count;
            while (length < input.Length && (count = stream.Read(input, length, input.Length-length)) > 0) length += count;
            if (length == 0 || length == input.Length || (args[0] == "seal" && length != 32)) return 2;
            value = new byte[length];
            Array.Copy(input, value, length);
            output = args[0] == "seal" ? ProtectedData.Protect(value, null, DataProtectionScope.CurrentUser)
                                      : ProtectedData.Unprotect(value, null, DataProtectionScope.CurrentUser);
            if (args[0] == "open" && output.Length != 32) return 2;
            Console.OpenStandardOutput().Write(output, 0, output.Length);
            return 0;
        } catch (Exception) { return 1; }
        finally {
            Array.Clear(input, 0, input.Length);
            if (output != null) Array.Clear(output, 0, output.Length);
            if (value != null) Array.Clear(value, 0, value.Length);
        }
    }
}
