cmake_minimum_required(VERSION 3.15)
project(omsi2tracker CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(omsi2tracker SHARED src/tracker.cpp src/exports.def)
target_link_libraries(omsi2tracker PRIVATE winhttp)
target_compile_definitions(omsi2tracker PRIVATE UNICODE _UNICODE)

if(MSVC)
  # statické CRT → uživatel nepotřebuje instalovat Visual C++ Redistributable
  set_property(TARGET omsi2tracker PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
else()
  target_link_options(omsi2tracker PRIVATE -static -static-libgcc -static-libstdc++ -Wl,--kill-at,--enable-stdcall-fixup)
endif()
