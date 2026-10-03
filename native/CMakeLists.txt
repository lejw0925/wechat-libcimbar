cmake_minimum_required(VERSION 3.16)
project(wechat_cimbar LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POLICY_VERSION_MINIMUM 3.5)
set(DISABLE_TESTS ON)
set(USE_WASM 1)
set(CIMBAR_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../third_party/libcimbar")
find_package(OpenCV REQUIRED COMPONENTS core imgproc)
include_directories(${OpenCV_INCLUDE_DIRS} "${CIMBAR_ROOT}/src/lib" "${CIMBAR_ROOT}/src/third_party_lib")
add_compile_definitions(GF256_TARGET_MOBILE ZSTD_STATIC_LINKING_ONLY)
add_compile_options(-fexceptions -ffile-prefix-map=${CMAKE_CURRENT_SOURCE_DIR}/..=.)
add_subdirectory("${CIMBAR_ROOT}/src/lib/cimb_translator" translator)
add_subdirectory("${CIMBAR_ROOT}/src/third_party_lib/libcorrect" correct)
add_subdirectory("${CIMBAR_ROOT}/src/third_party_lib/wirehair" wirehair)
add_subdirectory("${CIMBAR_ROOT}/src/third_party_lib/zstd" zstd)
add_library(cimbar_extract STATIC
  "${CIMBAR_ROOT}/src/lib/extractor/Extractor.cpp"
  "${CIMBAR_ROOT}/src/lib/extractor/Deskewer.cpp"
  "${CIMBAR_ROOT}/src/lib/extractor/Scanner.cpp")
add_executable(cimbar decoder.cpp)
target_link_libraries(cimbar PRIVATE cimbar_extract cimb_translator correct_static wirehair zstd ${OpenCV_LIBS})
target_link_options(cimbar PRIVATE
  --no-entry -Oz -fexceptions
  -sMODULARIZE=1 -sEXPORT_NAME=createCimbarModule -sENVIRONMENT=web
  -sFILESYSTEM=0 -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=33554432 -sMAXIMUM_MEMORY=268435456
  -sSTACK_SIZE=2097152 -sDISABLE_EXCEPTION_CATCHING=0 -sWASM_BIGINT=0
  -sDYNAMIC_EXECUTION=0 -sASSERTIONS=0
  -sTEXTDECODER=1
  "-sEXPORTED_FUNCTIONS=['_malloc','_free','_cb_reset','_cb_decode_rgba','_cb_progress','_cb_compressed_size','_cb_received_bytes','_cb_result_size','_cb_result_data','_cb_filename','_cb_error']"
  "-sEXPORTED_RUNTIME_METHODS=['HEAPU8','UTF8ToString']")

# A separate test-only encoder exercises the production decoder with real frames.
# It is never copied into the mini program.
add_executable(fixture_encoder fixture_encoder.cpp)
target_link_libraries(fixture_encoder PRIVATE cimb_translator correct_static wirehair zstd ${OpenCV_LIBS})
target_link_options(fixture_encoder PRIVATE
  --no-entry -Oz -fexceptions
  -sMODULARIZE=1 -sEXPORT_NAME=createFixtureModule -sENVIRONMENT=node
  -sFILESYSTEM=0 -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=33554432
  -sDISABLE_EXCEPTION_CATCHING=0 -sWASM_BIGINT=0
  "-sEXPORTED_FUNCTIONS=['_malloc','_free','_fixture_init','_fixture_init_raw','_fixture_next','_fixture_width','_fixture_height']"
  "-sEXPORTED_RUNTIME_METHODS=['HEAPU8']")
