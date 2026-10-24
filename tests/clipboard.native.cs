/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
﻿using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;

internal static class ClipboardDecoderHarness
{
    private const int MaxClipboardImageBytes = 16 * 1024 * 1024;
    private static MethodInfo _validatePng;
    private static MethodInfo _encodeBitmap;
    private static MethodInfo _readBoundedStream;
    private static int _checks;

    private sealed class HarnessFailure : Exception
    {
        internal HarnessFailure(string message) : base(message) { }
    }

    private static int Main(string[] args)
    {
        try
        {
            if (args.Length != 1 || !File.Exists(args[0]))
                throw new HarnessFailure("staging executable");

            Assembly assembly = Assembly.LoadFrom(Path.GetFullPath(args[0]));
            Type host = assembly.GetType("CTextureMaker.MainForm", true);
            _validatePng = GetPrivateStaticMethod(host, "ValidateClipboardPng");
            _encodeBitmap = GetPrivateStaticMethod(host, "EncodeClipboardBitmap");
            _readBoundedStream = GetPrivateStaticMethod(host, "ReadBoundedClipboardStream");

            CheckPngValidationPreservesAlpha();
            CheckPngValidationReturnsIndependentBytes();
            CheckRejectsNonPng();
            CheckRejectsCorruptPng();
            CheckRejectsOversizedStream();
            CheckRejectsOversizedImage();
            CheckBitmapFallbackPreservesAlpha();

            Console.WriteLine("PASS: " + _checks.ToString() + " clipboard decoder checks");
            return 0;
        }
        catch (HarnessFailure failure)
        {
            Console.WriteLine("FAIL: " + failure.Message);
            return 1;
        }
        catch (Exception)
        {
            Console.WriteLine("FAIL: clipboard decoder harness");
            return 1;
        }
    }

    private static MethodInfo GetPrivateStaticMethod(Type type, string name)
    {
        MethodInfo method = type.GetMethod(name, BindingFlags.NonPublic | BindingFlags.Static);
        if (method == null)
            throw new HarnessFailure("private decoder method");
        return method;
    }

    private static void CheckPngValidationPreservesAlpha()
    {
        byte[] png = MakePng(3, 1, true);
        byte[] validated = (byte[])_validatePng.Invoke(null, new object[] { png });
        CheckPngAlpha(validated, 3, new byte[] { 0, 128, 255 });
        _checks++;
    }

    private static void CheckPngValidationReturnsIndependentBytes()
    {
        byte[] input = MakePng(3, 1, true);
        byte[] validated = (byte[])_validatePng.Invoke(null, new object[] { input });
        if (Object.ReferenceEquals(input, validated))
            throw new HarnessFailure("PNG byte clone");
        byte firstValidatedByte = validated[0];
        input[0] = (byte)(input[0] ^ 0xFF);
        if (validated[0] != firstValidatedByte)
            throw new HarnessFailure("PNG byte clone");
        _checks++;
    }

    private static void CheckRejectsNonPng()
    {
        byte[] jpeg;
        using (Bitmap bitmap = new Bitmap(2, 1))
        using (MemoryStream output = new MemoryStream())
        {
            bitmap.Save(output, ImageFormat.Jpeg);
            jpeg = output.ToArray();
        }
        ExpectRejected(_validatePng, new object[] { jpeg }, "non-PNG rejection");
        _checks++;
    }

    private static void CheckRejectsCorruptPng()
    {
        ExpectRejected(_validatePng, new object[] { new byte[] { 0, 1, 2, 3 } }, "corrupt PNG rejection");
        _checks++;
    }

    private static void CheckRejectsOversizedStream()
    {
        byte[] bytes = new byte[MaxClipboardImageBytes + 1];
        using (MemoryStream input = new MemoryStream(bytes, false))
            ExpectRejected(_readBoundedStream, new object[] { input }, "oversized stream rejection");
        _checks++;
    }

    private static void CheckRejectsOversizedImage()
    {
        byte[] png = MakePng(8193, 1, false);
        ExpectRejected(_validatePng, new object[] { png }, "oversized image rejection");
        _checks++;
    }

    private static void CheckBitmapFallbackPreservesAlpha()
    {
        using (Bitmap bitmap = new Bitmap(3, 1, PixelFormat.Format32bppArgb))
        {
            SetAlphaPixels(bitmap);
            byte[] png = (byte[])_encodeBitmap.Invoke(null, new object[] { bitmap });
            CheckPngAlpha(png, 3, new byte[] { 0, 128, 255 });
        }
        _checks++;
    }

    private static byte[] MakePng(int width, int height, bool setAlphaPixels)
    {
        using (Bitmap bitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb))
        using (MemoryStream output = new MemoryStream())
        {
            if (setAlphaPixels)
                SetAlphaPixels(bitmap);
            bitmap.Save(output, ImageFormat.Png);
            return output.ToArray();
        }
    }

    private static void SetAlphaPixels(Bitmap bitmap)
    {
        bitmap.SetPixel(0, 0, Color.FromArgb(0, 220, 80, 40));
        bitmap.SetPixel(1, 0, Color.FromArgb(128, 40, 180, 90));
        bitmap.SetPixel(2, 0, Color.FromArgb(255, 25, 70, 210));
    }

    private static void CheckPngAlpha(byte[] bytes, int expectedWidth, byte[] expectedAlpha)
    {
        using (MemoryStream input = new MemoryStream(bytes, false))
        using (Bitmap image = new Bitmap(input))
        {
            if (image.RawFormat.Guid != ImageFormat.Png.Guid || image.Width != expectedWidth || image.Height != 1)
                throw new HarnessFailure("valid PNG output");
            for (int x = 0; x < expectedAlpha.Length; x++)
            {
                if (image.GetPixel(x, 0).A != expectedAlpha[x])
                    throw new HarnessFailure("alpha preservation");
            }
        }
    }

    private static void ExpectRejected(MethodInfo method, object[] args, string checkName)
    {
        try
        {
            method.Invoke(null, args);
        }
        catch (TargetInvocationException exception)
        {
            Exception cause = exception.InnerException;
            if (cause is InvalidDataException || cause is ArgumentException ||
                cause is ExternalException || cause is OutOfMemoryException)
                return;
        }
        throw new HarnessFailure(checkName);
    }
}