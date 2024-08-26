import { memo, useCallback, useEffect, useRef, useState } from "react";
import useResizeObserver from "./useResizeObserver";
import { debounce, mean, sum } from "lodash";
import { LoaderCircleIcon, DownloadIcon } from "lucide-react";
import { audioBufferToWavBlob } from "./toWav";
import { downloadFileFromUrl } from "./download";

type Info = {
  numberOfChannels: number;
  duration: number;
  sampleRate: number;
  channels: Array<AudioBuffer>;
  channelsVolume: Array<number>;
  monoRatio: number;
};

const MONO_THRESHOLD = 0.3;
const blobs = new WeakMap<Info, string[]>();

export default function Splitter() {
  const [obj, setObj] = useState<string>();
  const [name, setName] = useState<string>();
  const [info, setInfo] = useState<Info>();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>("");

  const setObjUrl = useCallback((data: File | undefined | null) => {
    setObj((old) => {
      if (old) {
        URL.revokeObjectURL(old);
      }
      return data ? URL.createObjectURL(data) : undefined;
    });
    setName(data?.name);
    setInfo(undefined);
  }, []);

  useEffect(() => {
    if (obj) {
      setIsLoading(true);
      setError("");
      mixer
        .loadData(obj)
        .then((info) => {
          setInfo(info);
          blobs.set(
            info,
            info.channels.map((buffer) =>
              URL.createObjectURL(audioBufferToWavBlob(buffer)),
            ),
          );
        })
        .catch(() => {
          setError("Unable to read data from file. 無法解析檔案資料");
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [obj]);

  useEffect(() => {
    if (info) {
      return () => {
        blobs.get(info)?.forEach((url) => {
          URL.revokeObjectURL(url);
        });
      };
    }
  }, [info]);

  return (
    <div className="m-6 flex flex-col gap-4 rounded-xl bg-white p-6">
      <h1 className="text-xl font-bold">Audio Splitter 聲道分離器</h1>
      <div>
        The file is processed in your browser. 檔案只會保存於您的瀏覽器中。
      </div>

      <div className="flex flex-col gap-6 rounded">
        <input
          type="file"
          placeholder="Upload Files"
          multiple={false}
          onChange={(e) => {
            setObjUrl(e.currentTarget.files?.[0]);
          }}
        />
        {isLoading && (
          <div className="flex items-center gap-2">
            <LoaderCircleIcon className="animate-spin" />
            檔案處理中
          </div>
        )}
        {error && <span className="text-red-600">{error}</span>}
        {info && (
          <dl>
            <dt className="font-bold">File 檔名</dt>
            <dd className="mb-2">{name}</dd>
            <dt className="font-bold">Duration 長度</dt>
            <dd className="mb-2">{info?.duration} seconds / 秒</dd>
            <dt className="font-bold">Channels 聲道數量</dt>
            <dd className="mb-2">{info?.numberOfChannels}</dd>
          </dl>
        )}
        {info &&
          info.channels.map((buffer, idx) => {
            const url = blobs.get(info)?.[idx];
            const trackName = idx === 0 ? "合成單聲道" : `聲道 ${idx}`;
            return (
              <div
                key={`${idx}:${buffer.length}`}
                className="flex flex-col gap-4 border-b border-neutral-500/30 pb-8 last-of-type:border-none"
              >
                <span className="font-bold">
                  {trackName}
                  {idx === 0 && info.monoRatio < MONO_THRESHOLD ? (
                    <span className="ml-2 text-red-600">
                      偵測到聲紋相位抵銷，音量抵銷至{" "}
                      {Math.round(info.monoRatio * 100)}%
                    </span>
                  ) : (
                    ""
                  )}
                </span>
                <div className="relative h-8">
                  <WaveBarCanvas arr={buffer.getChannelData(0)} />
                </div>
                {url && (
                  <>
                    <audio controls src={url} />
                    <button
                      className="inline-flex items-center gap-2 self-start rounded-lg bg-neutral-500/10 px-4 py-2 hover:bg-neutral-500/20"
                      onClick={() => {
                        downloadFileFromUrl(
                          url,
                          `${name} - ${trackName}`,
                          "wav",
                        );
                      }}
                    >
                      <DownloadIcon /> Download 下載音檔
                    </button>
                  </>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}

class AudioMixer {
  ctx: AudioContext;
  constructor() {
    this.ctx = new AudioContext({
      sampleRate: 48000,
    });
  }

  async loadData(url: string): Promise<Info> {
    const bufferData = await fetch(url).then((res) => res.arrayBuffer());
    if (!bufferData) {
      throw "No buffer";
    }
    const buffer = await this.ctx.decodeAudioData(bufferData);

    const info: Info = {
      numberOfChannels: buffer.numberOfChannels,
      duration: buffer.duration,
      sampleRate: buffer.sampleRate,
      channels: [],
      channelsVolume: [],
      monoRatio: 0,
    };

    const offCtx = new OfflineAudioContext({
      sampleRate: 48000,
      numberOfChannels: 1,
      length: info.duration * 48000,
    });

    const srcNode = offCtx.createBufferSource();
    srcNode.buffer = buffer;
    srcNode.connect(offCtx.destination);
    srcNode.start(0);

    const chunksSize = Math.round(info.duration * 2000 + 10);

    const monoBuffer = await offCtx.startRendering();
    info.channels.push(monoBuffer);
    info.channelsVolume.push(
      sum(this.getCanvasData(monoBuffer.getChannelData(0), chunksSize)),
    );

    for (let i = 0; i < buffer.numberOfChannels; i++) {
      const cb = this.ctx.createBuffer(
        1,
        buffer.duration * buffer.sampleRate,
        buffer.sampleRate,
      );
      const arr = buffer.getChannelData(i);
      cb.copyToChannel(arr, 0);
      info.channels.push(cb);
      info.channelsVolume.push(sum(this.getCanvasData(arr, chunksSize)));
    }

    info.monoRatio =
      info.channelsVolume[0] / mean(info.channelsVolume.slice(1));

    return info;
  }

  getCanvasData(arr: Float32Array, chunks: number) {
    if (!arr.length) {
      return [];
    }

    const data: number[] = [];

    let max = 0;
    const chunkSize = Math.floor(arr.length / chunks);
    for (let i = 1; i < arr.length; i += 1) {
      if (max < Math.abs(arr[i])) {
        max = arr[i];
      }
      if (i % chunkSize === 0) {
        data.push(max);
        max = 0;
      }
    }

    return data;
  }
}

const mixer = new AudioMixer();

const WaveBarCanvas = memo(function WaveBarCanvas(props: {
  arr: Float32Array;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [wrapper, { width, height }] = useResizeObserver<HTMLDivElement>();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const draw = useCallback(
    debounce(async () => {
      const barW = 2;
      const gap = 1;
      const chunkW = barW + gap;

      const el = ref.current;
      const canvas = el?.getContext("2d");
      if (!canvas || !el || !mixer) {
        return;
      }

      const data = mixer.getCanvasData(
        props.arr,
        Math.floor((width + 1) / chunkW),
      );

      const dpr = window.devicePixelRatio;

      // Set the "actual" size of the canvas
      const w = width * dpr;
      const h = height * dpr;
      el.width = w;
      el.height = h;

      canvas.fillStyle = "#088";
      // canvas.fillRect(0, 0, w, h);

      for (let i = 0; i < data.length; i++) {
        const val = data[i];
        const vh = Math.max(h * val, 2);
        const vt = (h - vh) / 2;
        canvas.fillRect(i * chunkW * dpr, vt, barW * dpr, vh);
      }
    }, 100),
    [width, height, debounce, mixer],
  );

  useEffect(() => {
    draw();
  }, [draw]);

  return (
    <div ref={wrapper} className="absolute inset-0">
      <canvas ref={ref} className="h-full w-auto object-cover" />
    </div>
  );
});
