use chesskers_engine::cli::{self, BestMoveOptions, EvalPromotionOptions};
use chesskers_engine::mcts::PROMOTION_WIN_THRESHOLD;
use std::io::{self, Read};
use std::path::PathBuf;
use std::process;

fn read_stdin() -> String {
    let mut input = String::new();
    io::stdin()
        .read_to_string(&mut input)
        .unwrap_or_else(|e| {
            eprintln!("{e}");
            process::exit(1);
        });
    input
}

fn usage() -> ! {
    eprintln!(
        "usage: chesskers-engine <legal-moves|apply-move|is-terminal|play-random|best-move|eval-promotion> [flags]"
    );
    eprintln!("  play-random [--seed N]");
    eprintln!("  best-move --model PATH [--think-ms N] [--depth N]");
    eprintln!("  eval-promotion --challenger STEM --baseline STEM [--models-dir DIR] [--threshold RATE] [--fixtures-dir DIR] [--side w|b]");
    process::exit(1);
}

fn parse_u64_flag(name: &str, value: &str) -> u64 {
    value.parse().unwrap_or_else(|_| {
        eprintln!("invalid {name} value: {value}");
        process::exit(1);
    })
}

fn parse_u32_flag(name: &str, value: &str) -> u32 {
    value.parse().unwrap_or_else(|_| {
        eprintln!("invalid {name} value: {value}");
        process::exit(1);
    })
}

fn parse_best_move_args(mut args: impl Iterator<Item = String>) -> BestMoveOptions {
    let mut model_path = None;
    let mut think_ms = 2000;
    let mut depth = 4;

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--model" => {
                let Some(value) = args.next() else {
                    eprintln!("--model requires a value");
                    process::exit(1);
                };
                model_path = Some(value);
            }
            "--think-ms" => {
                let Some(value) = args.next() else {
                    eprintln!("--think-ms requires a value");
                    process::exit(1);
                };
                think_ms = parse_u64_flag("--think-ms", &value);
            }
            "--depth" => {
                let Some(value) = args.next() else {
                    eprintln!("--depth requires a value");
                    process::exit(1);
                };
                depth = parse_u32_flag("--depth", &value);
            }
            _ => {
                eprintln!("unknown flag: {arg}");
                process::exit(1);
            }
        }
    }

    let Some(model_path) = model_path else {
        eprintln!("best-move requires --model PATH");
        process::exit(1);
    };

    BestMoveOptions {
        model_path,
        think_ms,
        depth,
    }
}

fn parse_eval_promotion_args(mut args: impl Iterator<Item = String>) -> EvalPromotionOptions {
    let engine_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let mut models_dir = engine_dir.join("models").to_string_lossy().into_owned();
    let mut fixtures_dir = engine_dir.join("../fixtures").to_string_lossy().into_owned();
    let mut challenger = None;
    let mut baseline = None;
    let mut threshold = PROMOTION_WIN_THRESHOLD;
    let mut side = None;

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--models-dir" => {
                models_dir = args.next().unwrap_or_else(|| {
                    eprintln!("--models-dir requires a value");
                    process::exit(1);
                });
            }
            "--fixtures-dir" => {
                fixtures_dir = args.next().unwrap_or_else(|| {
                    eprintln!("--fixtures-dir requires a value");
                    process::exit(1);
                });
            }
            "--challenger" => {
                challenger = Some(args.next().unwrap_or_else(|| {
                    eprintln!("--challenger requires a value");
                    process::exit(1);
                }));
            }
            "--baseline" => {
                baseline = Some(args.next().unwrap_or_else(|| {
                    eprintln!("--baseline requires a value");
                    process::exit(1);
                }));
            }
            "--threshold" => {
                let value = args.next().unwrap_or_else(|| {
                    eprintln!("--threshold requires a value");
                    process::exit(1);
                });
                threshold = value.parse().unwrap_or_else(|_| {
                    eprintln!("invalid --threshold value: {value}");
                    process::exit(1);
                });
            }
            "--side" => {
                side = Some(args.next().unwrap_or_else(|| {
                    eprintln!("--side requires a value");
                    process::exit(1);
                }));
            }
            _ => {
                eprintln!("unknown flag: {arg}");
                process::exit(1);
            }
        }
    }

    EvalPromotionOptions {
        models_dir,
        challenger: challenger.unwrap_or_else(|| {
            eprintln!("eval-promotion requires --challenger STEM");
            process::exit(1);
        }),
        baseline: baseline.unwrap_or_else(|| {
            eprintln!("eval-promotion requires --baseline STEM");
            process::exit(1);
        }),
        threshold,
        fixtures_dir,
        side,
    }
}

fn main() {
    let mut args = std::env::args().skip(1);
    let Some(command) = args.next() else {
        usage();
    };

    if command == "best-move" {
        let options = parse_best_move_args(args);
        let input = read_stdin();
        match cli::run_best_move(&input, &options) {
            Ok(json) => println!("{json}"),
            Err(err) => {
                println!(
                    "{}",
                    serde_json::to_string(&err).unwrap_or_else(|_| {
                        r#"{"error":"serialization failed"}"#.to_string()
                    })
                );
                process::exit(1);
            }
        }
        return;
    }

    if command == "eval-promotion" {
        let options = parse_eval_promotion_args(args);
        match cli::run_eval_promotion(&options) {
            Ok(json) => println!("{json}"),
            Err(err) => {
                println!(
                    "{}",
                    serde_json::to_string(&err).unwrap_or_else(|_| {
                        r#"{"error":"serialization failed"}"#.to_string()
                    })
                );
                process::exit(1);
            }
        }
        return;
    }

    let mut seed: Option<u64> = None;
    if command == "play-random" {
        while let Some(arg) = args.next() {
            if arg == "--seed" {
                let Some(value) = args.next() else {
                    eprintln!("--seed requires a value");
                    process::exit(1);
                };
                seed = Some(parse_u64_flag("--seed", &value));
            } else {
                eprintln!("unknown flag: {arg}");
                process::exit(1);
            }
        }
        if seed.is_none() {
            seed = Some(
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_nanos() as u64)
                    .unwrap_or(0),
            );
        }
    } else if args.next().is_some() {
        usage();
    }

    if matches!(
        command.as_str(),
        "legal-moves" | "apply-move" | "is-terminal" | "play-random"
    ) {
        let input = read_stdin();
        match cli::run_with_seed(&command, &input, seed) {
            Ok(json) => println!("{json}"),
            Err(err) => {
                println!(
                    "{}",
                    serde_json::to_string(&err).unwrap_or_else(|_| {
                        r#"{"error":"serialization failed"}"#.to_string()
                    })
                );
                process::exit(1);
            }
        }
    } else {
        eprintln!("unknown command: {command}");
        process::exit(1);
    }
}
