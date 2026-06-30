'use client';

import React, { useState, useRef } from 'react';
import { S3Client, PutObjectCommand, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3Client = new S3Client({
  region: process.env.NEXT_PUBLIC_AWS_REGION,
  credentials: {
    accessKeyId: process.env.NEXT_PUBLIC_AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.NEXT_PUBLIC_AWS_SECRET_ACCESS_KEY || '',
  },
});

const BUCKET_NAME = process.env.NEXT_PUBLIC_AWS_BUCKET_NAME;

export default function Home() {
  const [isDragActive, setIsDragActive] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [zipUrl, setZipUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ⭕ ドラッグ中の挙動を一本化し、ブラウザの標準動作を確実にストップさせます
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragActive(true);
    } else if (e.type === "dragleave") {
      setIsDragActive(false);
    }
  };

  // ⭕ フォルダがドロップされたときの処理
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);

    console.log("💥 ドロップイベントを検知しました！");

    const items = e.dataTransfer.items;
    if (!items) {
      console.log("❌ ドロップされたアイテム（データ転送）がありません。");
      return;
    }
    if (!BUCKET_NAME) {
      setStatusMessage('❌ AWSバケット名の環境変数が設定されていません。');
      return;
    }

    setStatusMessage('📁 フォルダ構造をスキャン中...');
    const files: File[] = [];
    
    const traverseFileTree = async (item: any, path = "") => {
      if (item.isFile) {
        const file = await new Promise<File>((resolve) => item.file(resolve));
        Object.defineProperty(file, 'webkitRelativePath', {
          value: path + file.name
        });
        if (file.type.startsWith('image/')) {
          files.push(file);
        }
      } else if (item.isDirectory) {
        const dirReader = item.createReader();
        const entries = await new Promise<any[]>((resolve) => dirReader.readEntries(resolve));
        for (const entry of entries) {
          await traverseFileTree(entry, path + item.name + "/");
        }
      }
    };

    try {
      for (let i = 0; i < items.length; i++) {
        const item = items[i].webkitGetAsEntry();
        if (item) await traverseFileTree(item);
      }

      console.log(`📸 スキャン完了。画像ファイル数: ${files.length}個`);

      if (files.length > 0) {
        uploadFilesToS3(files);
      } else {
        setStatusMessage('❌ 有効な画像ファイルが見つかりませんでした。フォルダの中に画像（JPG/PNG等）があるか確認してください。');
      }
    } catch (err) {
      console.error("フォルダスキャンエラー:", err);
      setStatusMessage('❌ フォルダの読み込み中にエラーが発生しました。');
    }
  };

  const uploadFilesToS3 = async (files: File[]) => {
    const totalFiles = files.length;
    let uploadedCount = 0;
    setUploadProgress(0);
    setStatusMessage(`🚀 S3へアップロード中... (0 / ${totalFiles})`);

    const concurrencyLimit = 5;
    const chunks = [];
    for (let i = 0; i < files.length; i += concurrencyLimit) {
      chunks.push(files.slice(i, i + concurrencyLimit));
    }

    let targetFolderName = "processed_photos/";
    if (files[0] && files[0].webkitRelativePath) {
      const parts = files[0].webkitRelativePath.split('/');
      if (parts.length > 1) {
        targetFolderName = parts[0] + "/";
      }
    }

    try {
      for (const chunk of chunks) {
        await Promise.all(
          chunk.map(async (file) => {
            const s3Key = `uploads/${file.webkitRelativePath}`;
            const arrayBuffer = await file.arrayBuffer();
            const buffer = new Uint8Array(arrayBuffer);

            const command = new PutObjectCommand({
              Bucket: BUCKET_NAME,
              Key: s3Key,
              Body: buffer,
              ContentType: file.type,
            });

            await s3Client.send(command);
            uploadedCount++;
            setUploadProgress(Math.round((uploadedCount / totalFiles) * 100));
            setStatusMessage(`🚀 S3へアップロード中... (${uploadedCount} / ${totalFiles})`);
          })
        );
      }

      setStatusMessage('🔔 仕分け完了同期シグナルを送信中...');
      const signalKey = `uploads/${targetFolderName}generate_zip.txt`;
      const signalCommand = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: signalKey,
        Body: String(totalFiles),
        ContentType: 'text/plain',
      });
      await s3Client.send(signalCommand);

      setUploadProgress(null);
      startPollingForZip();

    } catch (error) {
      console.error('S3 Upload Error:', error);
      setStatusMessage('❌ アップロード中にエラーが発生しました。');
      setUploadProgress(null);
    }
  };

  const startPollingForZip = () => {
    const targetPrefix = `zip/`;
    let attempts = 0;
    const maxAttempts = 60;

    setStatusMessage('🤖 ①仕分けの全完了を検証中... ②③ZIPパッケージングを待っています...');

    const interval = setInterval(async () => {
      attempts++;
      
      try {
        const listResponse = await s3Client.send(new ListObjectsV2Command({
          Bucket: BUCKET_NAME,
          Prefix: targetPrefix
        }));

        const zipFiles = listResponse.Contents?.filter((obj: any) => obj.Key?.endsWith('.zip'));

        if (zipFiles && zipFiles.length > 0) {
          zipFiles.sort((a: any, b: any) => (b.LastModified?.getTime() || 0) - (a.LastModified?.getTime() || 0));
          const latestZip = zipFiles[0];

          if (latestZip && latestZip.Key) {
            clearInterval(interval);
            setStatusMessage('✨ すべての仕分け工程とZIP作成が完全に終了しました！');
            
            const downloadCommand = new GetObjectCommand({
              Bucket: BUCKET_NAME,
              Key: latestZip.Key,
            });
            
            const presignedUrl = await getSignedUrl(s3Client, downloadCommand, { expiresIn: 900 });
            setZipUrl(presignedUrl);
          }
        } else {
          throw new Error('Waiting for zip...');
        }

      } catch (error: any) {
        if (attempts >= maxAttempts) {
          clearInterval(interval);
          setStatusMessage('⏳ 処理が混雑しています。AWSコンソールのCloudWatch Logsを確認してください。');
        }
      }
    }, 3000);
  };

  return (
    <main className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8 text-gray-900" onDragOver={(e) => e.preventDefault()}>
      <div className="max-w-3xl mx-auto space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-extrabold text-blue-600 sm:text-4xl">🏐 写真AI自動仕分けシステム</h1>
          <p className="mt-2 text-sm text-gray-600">写真入りフォルダを選択するだけで、写真仕分けAIシステムが自動仕分けされたzipを生成します。</p>
        </div>

        {/* ⭕ onDragOverを一本化したhandleDragに変更しました */}
        <div
          onDragEnter={handleDrag} 
          onDragOver={handleDrag} 
          onDragLeave={handleDrag} 
          onDrop={handleDrop} 
          onClick={() => fileInputRef.current?.click()}
          className={`mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-dashed rounded-lg transition-colors cursor-pointer ${
            isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white hover:bg-gray-50'
          }`}
        >
          <div className="space-y-1 text-center py-10">
            <svg className="mx-auto h-12 w-12 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48">
              <path d="M20 8H8a4 4 0 00-4 4v24a4 4 0 004 4h32a4 4 0 004-4V16a4 4 0 00-4-4H24l-4-4z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="font-medium text-blue-600">ここクリックして写真入りのフォルダを選択します</p>
            <input
              type="file" ref={fileInputRef} className="hidden" multiple
              {...{ webkitdirectory: "", directory: "" } as any}
              onChange={(e) => { if (e.target.files && e.target.files.length > 0) uploadFilesToS3(Array.from(e.target.files)); }}
            />
          </div>
        </div>

        {statusMessage && (
          <div className="p-4 bg-white rounded-md shadow border border-gray-200 text-center">
            <p className="text-sm font-medium text-gray-700">{statusMessage}</p>
            {uploadProgress !== null && (
              <div className="w-full bg-gray-200 rounded-full h-2.5 mt-3">
                <div className="bg-blue-600 h-2.5 rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }}></div>
              </div>
            )}
          </div>
        )}

        {zipUrl && (
          <div className="p-6 bg-green-50 border border-green-200 rounded-lg text-center space-y-4">
            <h3 className="text-lg font-bold text-green-800">✨ ④ 仕分け済みZIPのダウンロード準備完了</h3>
            <a href={zipUrl} download className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700">
              📦 仕分け済みZIPをダウンロード
            </a>
          </div>
        )}
      </div>
    </main>
  );
}