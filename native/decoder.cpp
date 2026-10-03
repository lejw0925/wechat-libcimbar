// SPDX-License-Identifier: MPL-2.0
// Adapter around sz3/libcimbar. The algorithm and wire format remain upstream's.
#include <algorithm>
#include <cstdint>
#include <memory>
#include <string>
#include <utility>
#include <vector>
#include "cimb_translator/Config.h"
#include "encoder/Decoder.h"
#include "encoder/escrow_buffer_writer.h"
#include "extractor/Extractor.h"
#include "fountain/fountain_decoder_stream.h"
#include "zstd/zstd.h"

namespace {
constexpr unsigned MAX_COMPRESSED = 16 * 1024 * 1024;
constexpr unsigned MAX_OUTPUT = 64 * 1024 * 1024;
std::unique_ptr<Decoder> decoder;
std::unique_ptr<Extractor> extractor;
std::unique_ptr<fountain_decoder_stream> stream;
std::vector<unsigned char> chunks, output;
std::string filename, error;
uint32_t stream_id = 0;
unsigned compressed_size = 0;
unsigned received_bytes = 0;
bool completed = false;

int fail(const char* message) {
    error = message;
    output.clear();
    return -1;
}

int finish() {
    auto packed = stream->recover();
    if (!packed) return fail("无法重组文件，请重新接收");
    stream.reset();

    // Filename is stored in a Zstandard skippable frame. Check lengths before
    // reading it; a transmitted filename is untrusted input.
    if (packed->size() >= 8 && ZSTD_isSkippableFrame(packed->data(), packed->size())) {
        unsigned char name[512];
        size_t count = ZSTD_readSkippableFrame(name, sizeof(name), nullptr, packed->data(), packed->size());
        if (!ZSTD_isError(count) && count > 1 && name[0] == 1)
            filename.assign(reinterpret_cast<char*>(name + 1), count - 1);
    }

    std::unique_ptr<ZSTD_DStream, decltype(&ZSTD_freeDStream)> ds(ZSTD_createDStream(), &ZSTD_freeDStream);
    if (!ds || ZSTD_isError(ZSTD_initDStream(ds.get()))) return fail("无法初始化解压器");
    // Bound both decompression window and actual output, including unknown-size streams.
    if (ZSTD_isError(ZSTD_DCtx_setParameter(ds.get(), ZSTD_d_windowLogMax, 26)))
        return fail("无法设置解压限制");
    ZSTD_inBuffer input = {packed->data(), packed->size(), 0};
    std::vector<unsigned char> scratch(ZSTD_DStreamOutSize());
    size_t remaining = 1;
    while (input.pos < input.size || remaining != 0) {
        ZSTD_outBuffer dest = {scratch.data(), scratch.size(), 0};
        const size_t before = input.pos;
        remaining = ZSTD_decompressStream(ds.get(), &dest, &input);
        if (ZSTD_isError(remaining)) return fail("文件解压校验失败，请重新接收");
        if (dest.pos > MAX_OUTPUT - output.size()) return fail("解压后文件超过 64 MiB 上限");
        output.insert(output.end(), scratch.begin(), scratch.begin() + dest.pos);
        if (input.pos == before && dest.pos == 0) return fail("收到的压缩文件不完整");
        if (input.pos == input.size && remaining == 0) break;
    }
    completed = true;
    return 2;
}
}

extern "C" {
int cb_reset(int mode) {
    if (mode != 68 && mode != 67 && mode != 66 && mode != 4 && mode != 8)
        return fail("不支持的 cimbar 模式");
    stream.reset();
    decoder.reset();
    extractor.reset();
    output.clear();
    output.shrink_to_fit();
    filename.clear();
    error.clear();
    stream_id = 0;
    compressed_size = 0;
    received_bytes = 0;
    completed = false;
    cimbar::Config::update(mode);
    cv::setNumThreads(1);
    decoder = std::make_unique<Decoder>();
    extractor = std::make_unique<Extractor>();
    chunks.resize(cimbar::Config::fountain_chunk_size() *
                  cimbar::Config::fountain_chunks_per_frame(cimbar::Config::bits_per_cell()));
    return 0;
}

// 0: no usable chunks, 1: receiving, 2: complete, -1: fatal/session error.
int cb_decode_rgba(const unsigned char* rgba, unsigned width, unsigned height) {
    if (completed) return 2;
    if (!decoder || !extractor) return fail("解码器尚未初始化");
    if (!rgba || width < 64 || height < 64 || width > 4096 || height > 4096 ||
        static_cast<uint64_t>(width) * height > 4096 * 2160)
        return fail("不支持的相机帧尺寸");
    try {
        cv::Mat rgb, aligned;
        cv::cvtColor(cv::Mat(height, width, CV_8UC4, const_cast<unsigned char*>(rgba)), rgb, cv::COLOR_RGBA2RGB);
        const int extracted = extractor->extract(rgb, aligned);
        if (!extracted) return 0;
        const unsigned chunk_size = cimbar::Config::fountain_chunk_size();
        escrow_buffer_writer writer(chunks.data(), chunks.size() / chunk_size, chunk_size);
        decoder->decode_fountain(aligned, writer, extracted == Extractor::NEEDS_SHARPEN);
        for (unsigned i = 0; i < writer.buffers_in_use(); ++i) {
            const char* chunk = reinterpret_cast<const char*>(chunks.data() + i * chunk_size);
            FountainMetadata md(chunk, chunk_size);
            if (!md.file_size()) continue;
            if (!stream) {
                if (md.file_size() > MAX_COMPRESSED) return fail("压缩文件超过 16 MiB 上限");
                auto candidate = std::make_unique<fountain_decoder_stream>(md.file_size(), chunk_size);
                if (!candidate->good()) continue;
                stream_id = md.id();
                compressed_size = md.file_size();
                stream = std::move(candidate);
            }
            // Never mix packets from different senders/files into one transfer.
            if (md.id() != stream_id) continue;
            const bool done = stream->write(chunk, chunk_size);
            // Count distinct fountain payloads, not camera pixels or repeated
            // frames. Keep the final count after finish() releases the stream.
            received_bytes = stream->progress() * stream->block_size();
            if (done) return finish();
        }
        return writer.buffers_in_use() ? 1 : 0;
    } catch (const cv::Exception&) {
        // A failed geometric fit is normal camera noise; wait for the next frame.
        return 0;
    } catch (const std::exception&) {
        return fail("解码内存不足或数据异常，请重新接收较小文件");
    }
}

int cb_progress() {
    if (completed) return 1000;
    if (!stream || !stream->blocks_required()) return 0;
    return std::min(990u, stream->progress() * 1000 / stream->blocks_required());
}
unsigned cb_compressed_size() { return compressed_size; }
unsigned cb_received_bytes() { return received_bytes; }
unsigned cb_result_size() { return output.size(); }
const unsigned char* cb_result_data() { return output.data(); }
const char* cb_filename() { return filename.c_str(); }
const char* cb_error() { return error.c_str(); }
}
