// SPDX-License-Identifier: MPL-2.0
// Development-only encoder. It is excluded from all mini program artifacts.
#include <utility>
#include "encoder/Encoder.h"
#include "util/byte_istream.h"
namespace {
std::unique_ptr<Encoder> encoder;
fountain_encoder_stream::ptr source;
cv::Mat frame;
}
extern "C" {
int fixture_init(const unsigned char* data, unsigned size, const char* name, int mode) {
    cimbar::Config::update(mode);
    encoder = std::make_unique<Encoder>();
    encoder->set_encode_id(17);
    cimbar::byte_istream input(reinterpret_cast<const char*>(data), size);
    source = encoder->create_fountain_encoder(input, name, 3);
    return source ? 1 : 0;
}
int fixture_init_raw(const unsigned char* data, unsigned size, int mode) {
    cimbar::Config::update(mode);
    encoder = std::make_unique<Encoder>();
    encoder->set_encode_id(18);
    cimbar::byte_istream input(reinterpret_cast<const char*>(data), size);
    source = encoder->create_fountain_encoder(input, "", 0);
    return source ? 1 : 0;
}
const unsigned char* fixture_next() {
    auto next = encoder->encode_next(*source);
    if (!next) return nullptr;
    cv::cvtColor(*next, frame, cv::COLOR_RGB2RGBA);
    return frame.data;
}
unsigned fixture_width() { return frame.cols; }
unsigned fixture_height() { return frame.rows; }
}
